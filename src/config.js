import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { findCycle } from './order.js';

/** @typedef {{name:string,url:string}} Link */
/**
 * @typedef {{
 *  id:string, name:string, emoji:string, section:string, needs:string[],
 *  kind:'shell'|'links'|'builtin', window:boolean, sudo:boolean, appStore:boolean,
 *  check:string|null, install:string|null, after:string|null,
 *  builtin:'zshrc'|'zprofile'|null, links:Link[], browser:string|null,
 *  app:string[]|null, versionCmd:string|null, sizePath:string|null, note:string|null
 * }} Item
 */
/** @typedef {{sections:{id:string,title:string}[], items:Item[]}} Config */

export class ConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`items.yaml has ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const ID_RE = /^[a-z0-9-]+$/;
const BUILTINS = ['zshrc', 'zprofile'];

/** Expand YAML shorthands (brew, brew_cask, brew_tap, mas) into a normalized Item. */
export function expandItem(raw) {
  const needs = new Set(Array.isArray(raw.needs) ? raw.needs : []);
  let check = null, install = null, versionCmd = null, sizePath = null;
  let sudo = raw.sudo === true;
  const app = raw.app == null ? null : (Array.isArray(raw.app) ? raw.app : [raw.app]).map(String);
  if (app?.length) sizePath = `/Applications/${app[0]}`;

  if (raw.brew) {
    check = `brew list --formula ${raw.brew} >/dev/null 2>&1`;
    install = `brew install ${raw.brew}`;
    versionCmd = `brew list --versions ${raw.brew}`;
    sizePath ??= `$(brew --prefix ${raw.brew})`;
    needs.add('homebrew');
  } else if (raw.brew_cask) {
    check = `brew list --cask ${raw.brew_cask} >/dev/null 2>&1`;
    install = `brew install --cask ${raw.brew_cask}`;
    versionCmd = `brew list --cask --versions ${raw.brew_cask}`;
    needs.add('homebrew');
  } else if (raw.mas != null) {
    check = `mas list | grep -q "^${raw.mas} "`;
    install = `mas install ${raw.mas}`;
    versionCmd = `mas list | grep "^${raw.mas} "`;
    sudo = raw.sudo ?? true;
    needs.add('mas');
  }
  if (raw.brew_tap) {
    // Homebrew 7 refuses to load untrusted third-party taps; trust only this one cask/formula.
    // Optional: older Homebrew has no `trust` command, and explicitly tapped taps may already be trusted.
    const target = raw.brew_cask ? `--cask ${raw.brew_cask}` : raw.brew ? `--formula ${raw.brew}` : null;
    const trust = target ? ` && { brew trust ${target} 2>/dev/null || true; }` : '';
    install = `brew tap ${raw.brew_tap}${trust} && ${install ?? 'true'}`;
    needs.add('homebrew');
  }
  if (raw.check != null) check = String(raw.check).trim();
  if (raw.install != null) install = String(raw.install).trim();
  if (raw.version != null) versionCmd = String(raw.version).trim();

  const links = Array.isArray(raw.links) ? raw.links.map((l) => ({ name: String(l.name), url: String(l.url) })) : [];
  const builtin = raw.builtin ?? null;
  const kind = builtin ? 'builtin' : links.length ? 'links' : 'shell';

  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    emoji: raw.emoji ?? '📦',
    section: raw.section,
    needs: [...needs],
    kind,
    window: raw.window ?? sudo, // password prompts belong in a visible window, not behind the spinner
    sudo,
    appStore: raw.mas != null,
    check: kind === 'links' ? null : check,
    install,
    after: raw.after != null ? String(raw.after).trim() : null,
    builtin,
    links,
    browser: raw.browser ?? null,
    app,
    versionCmd,
    sizePath,
    note: raw.note != null ? String(raw.note).trim() : null,
    setup: raw.setup != null ? String(raw.setup).trim() : null,
    heavy: raw.heavy === true,
  };
}

/** Parse + validate YAML text. Throws ConfigError listing every problem. */
export function parseConfig(yamlText) {
  let doc;
  try {
    doc = parseYaml(yamlText);
  } catch (e) {
    throw new ConfigError([`invalid YAML: ${e.message.split('\n')[0]}`]);
  }
  const problems = [];
  const sections = Array.isArray(doc?.sections) ? doc.sections : [];
  const rawItems = Array.isArray(doc?.items) ? doc.items : [];
  if (!sections.length) problems.push('no "sections" defined');
  if (!rawItems.length) problems.push('no "items" defined');
  const sectionIds = new Set(sections.map((s) => s.id));

  const items = [];
  const seen = new Set();
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') { problems.push('an item is not an object'); continue; }
    const label = `"${raw.name ?? raw.id}"`;
    if (!raw.id || !ID_RE.test(String(raw.id))) problems.push(`invalid id "${raw.id}" (use lowercase letters, digits, dashes)`);
    if (seen.has(raw.id)) problems.push(`duplicate id "${raw.id}"`);
    seen.add(raw.id);
    if (!sectionIds.has(raw.section)) problems.push(`item ${label}: unknown section "${raw.section}"`);
    if (raw.builtin != null && !BUILTINS.includes(raw.builtin)) problems.push(`item ${label}: unknown builtin "${raw.builtin}"`);
    const item = expandItem(raw);
    if (item.kind === 'shell' && !item.install) problems.push(`item ${label} has nothing to do (no install, links or builtin)`);
    for (const l of item.links) if (!/^https?:\/\//.test(l.url)) problems.push(`item ${label}: link "${l.name}" has invalid url`);
    items.push(item);
  }
  for (const item of items) {
    for (const n of item.needs) if (!seen.has(n)) problems.push(`item "${item.name}": unknown need "${n}"`);
  }
  const cycle = findCycle(items);
  if (cycle) problems.push(`dependency cycle: ${cycle.join(' → ')}`);
  if (problems.length) throw new ConfigError(problems);
  return { sections: sections.map((s) => ({ id: s.id, title: s.title ?? s.id })), items };
}

export function loadConfig(path) {
  return parseConfig(readFileSync(path, 'utf8'));
}
