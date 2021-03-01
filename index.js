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

async function find() {
  let targets = new Set();
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
    console.log(url);
    const current = docs[url];
    await page.goto(url);
    try {
      await page.waitForSelector(config.content, {timeout: 5000});
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
    console.log([...links]);
    targets = union(targets, new Set(links));
    // Now, while you're still on this page, check intra-page links.
  }
  // Now check inter-page links.
  await browser.close();
}

find();