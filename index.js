const { resolve } = require('path');
const { readdir } = require('fs').promises;
const puppeteer = require('puppeteer');
const config = require('./config.json');
const { writeFileSync } = require('fs');

// https://stackoverflow.com/a/45130990
async function getFiles(dir) {
  const dirents = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(dirents.map((dirent) => {
    const res = resolve(dir, dirent.name);
    return dirent.isDirectory() ? getFiles(res) : res;
  }));
  return Array.prototype.concat(...files);
}

async function removeNodes(page) {
  if (!config.removals) return;
  const selectors = config.removals;
  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i];
    await page.$$eval(selector, nodes => nodes.forEach(node => node.remove()));
  }
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set#implementing_basic_set_operations
function union(setA, setB) {
  let _union = new Set(setA)
  for (let elem of setB) {
      _union.add(elem)
  }
  return _union
}

async function getSectionIds(page) {
  try {
    return await page.$$eval(`*[id]`, nodes => {
      const ids = [];
      nodes.forEach(node => {
        if (node.id) ids.push(node.id.toLowerCase());
      })
      return ids;
    });
  } catch (error) {
    console.error(`Error while getting section IDs for ${page.url()}`);
    return [];
  }
}

async function getLinks(page, selector) {
  return await page.$$eval(`${selector} a`, links => {
    const set = new Set();
    links.forEach(link => {
      const url = new URL(link);
      set.add(`${url.origin.toLowerCase()}${url.pathname.toLowerCase()}${url.search.toLowerCase()}${url.hash.toLowerCase()}`);
    });
    return [...set];
  });
}

function parse(link) {
  const output = {};
  output.page = link;
  // TODO(kaycebasques): Handle this edge case: https://groups.google.com/forum/#!forum/google-chrome-developer-tools
  if (link.includes('#')) {
    output.page = link.substring(0, link.indexOf('#'));
    output.section = link.substring(link.indexOf('#') + 1);
  }
  return output;
}

async function audit() {
  let data = {
    docs: {},
    links: {}
  };
  // Recursively collect all Markdown files in the target directory.
  const files = await getFiles(config.path);
  const markdown = files.filter(file => file.endsWith('index.md'));
  markdown.forEach(file => {
    let url = file.replace(config.path, config.url);
    url = url.replace('index.md', '');
    data.docs[url] = {
      links: null
    };
    data.links[url] = {
      ok: null,
      sections: null
    };
  });
  const browser = await puppeteer.launch({headless: false});
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  // First, we crawl all of the target pages and collect the IDs of all
  // the sections that actually exist on these pages as all of the links
  // on each page. 
  for (url in data.docs) {
    try {
      if (config.pattern && !url.includes(config.pattern)) continue;
      await page.goto(url);
      await page.waitForSelector(config.content);
    } catch (error) {
      console.error(`\nError: ${url}`);
      console.error(error);
      data.links[url].ok = false;
      data.links[url].sections = null;
      data.docs[url].links = null;
      continue;
    }
    await removeNodes(page);
    data.links[url].sections = await getSectionIds(page);
    data.links[url].ok = true;
    const links = await getLinks(page, config.content);
    data.docs[url].links = {};
    links.forEach(link => {
      data.docs[url].links[link] = null;
    });
  }

  for (doc in data.docs) {
    if (!data.docs[doc].links) continue;
    const links = Object.keys(data.docs[doc].links);
    for (let i = 0; i < links.length; i++) {
      let response;
      let id = links[i];
      if (id.includes('#')) id = id.substring(0, id.indexOf('#'));
      if (!data.links[id]) {
        data.links[id] = {
          ok: null,
          sections: null
        };
        try {
          response = await page.goto(id);
        } catch (error) {
          console.error(`\nError: ${id}`);
          console.error(error);
          data.links[id].ok = false;
          data.links[id].sections = null;
          continue;
        }
        const ok = response.status() >= 200 && response.status() <= 300;
        data.links[id].ok = ok;
        ok ? data.links[id].sections = await getSectionIds(page) : data.links[id].sections = null;
      }
    }
  }

  for (doc in data.docs) {
    for (link in data.docs[doc].links) {
      let { page, section } = parse(link);
      // Handle trailing slashes.
      if (!data.links[page] && data.links[`${page}/`]) page = `${page}/`;
      if (section) {
        if (!data.links[page].sections) data.docs[doc].links[link] = false;
        if (data.links[page].sections) data.docs[doc].links[link] = data.links[page].sections.includes(section);
      }
      if (!section) data.docs[doc].links[link] = data.links[page].ok;
    }
  }

  await browser.close();
  writeFileSync('./report.json', JSON.stringify(data.docs, null, 2));
}

audit();

// Should only visit each page once
// Should visit section links while on that page