const { resolve } = require('path');
const { readdir } = require('fs').promises;
const puppeteer = require('puppeteer');
const config = require('./config.json');

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

async function audit() {
  let urls = {};
  // Recursively collect all Markdown files in the target directory.
  const files = await getFiles(config.path);
  const markdown = files.filter(file => file.endsWith('index.md'));
  // TODO(kaycebasques): We need to know the pages we've audited,
  // and the links on each page (so we know where to go if something is broken)
  // but we don't want to visit pages more than once.
  const docs = {};
  // Map the file paths to URLs.
  markdown.forEach(file => {
    let url = file.replace(config.path, config.url);
    url = url.replace('index.md', '');
    docs[url] = {};
  });
  const browser = await puppeteer.launch({headless: false});
  const page = await browser.newPage();
  for (url in docs) {
    console.log(`in ${url}`);
    await page.goto(url);
    try {
      await page.waitForSelector(config.content, {timeout: 3000});
    } catch (error) {
      console.error(error);
      continue;
    }
    await removeNodes(page);
    // Get all of the links on the page.
    const links = await page.$$eval(`${config.content} a`, links => {
      const set = new Set();
      links.forEach(link => {
        const url = new URL(link);
        set.add(`${url.origin}${url.pathname}${url.hash}`);
      });
      return [...set];
    });
    links.forEach(link => {
      if (!urls[link]) urls[link] = undefined;
    });
    const samePageLinks = links.filter(link => link.includes(url));
    // console.log(samePageLinks);
    const sections = samePageLinks.map(link => link.substring(link.indexOf('#')));
    for (let i = 0; i < sections.length; i++) {
      try {
        const section = sections[i];
        const node = await page.$(section);
        if (!node) console.log(`${section} not found!`);
      } catch (error) {
        console.error(`error while checking ${section}`);
      }
      
    }
    // Now, while you're still on this page, check intra-page links.
  }
  // Now check inter-page links.
  await browser.close();
}

audit();

// Should only visit each page once
// Should visit section links while on that page