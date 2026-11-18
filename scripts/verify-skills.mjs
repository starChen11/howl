#!/usr/bin/env node
// 校验 .dsh/skills/ 下的固化技能是否与 docs/process/SKILLS.lock.json 一致。
//
//   node scripts/verify-skills.mjs            校验，不一致时退出码 1
//   node scripts/verify-skills.mjs --update   按当前技能内容重写 lock
//
// 只用 Node 内置模块，macOS 与 Windows 行为一致；不需要 bash、python 或第三方依赖。
// Node 18 及以上。

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, '.dsh', 'skills');
const lockPath = join(root, 'docs', 'process', 'SKILLS.lock.json');
const update = process.argv.includes('--update');
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 递归收集文件，返回相对路径（统一用 /），按字典序排序。 */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(relative(base, full).split(/[\\/]/).join('/'));
  }
  return out.sort();
}

const sha256 = (buf) => 'sha256:' + createHash('sha256').update(buf).digest('hex');

/** 从 SKILL.md 的 frontmatter 里取 name / description / metadata.version / metadata.source。 */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const out = {};
  let inMetadata = false;
  for (const line of lines) {
    if (/^\S/.test(line)) inMetadata = /^metadata:/.test(line);
    const kv = line.match(/^(\s*)([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, indent, key, rawValue] = kv;
    const value = rawValue.trim().replace(/^["']|["']$/g, '');
    if (!indent) {
      if (key === 'name' || key === 'description') out[key] = value;
      continue;
    }
    if (inMetadata && (key === 'version' || key === 'source')) out[key] = value;
  }
  return out;
}

function collect() {
  if (!existsSync(skillsDir)) {
    console.error(`找不到目录：${skillsDir}`);
    process.exit(2);
  }
  const skills = {};
  const problems = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (!KEBAB.test(name)) problems.push(`${name}: 目录名不是 kebab-case`);
    const dir = join(skillsDir, name);
    const files = walk(dir);
    if (!files.includes('SKILL.md')) {
      problems.push(`${name}: 缺少 SKILL.md（技能必须是 .dsh/skills/<name>/SKILL.md）`);
      continue;
    }
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const fm = parseFrontmatter(text);
    if (fm.name !== name)
      problems.push(`${name}: SKILL.md 的 name 是 "${fm.name}", 与目录名不一致`);
    skills[name] = {
      version: fm.version ?? null,
      source: fm.source ?? null,
      files: Object.fromEntries(files.map((f) => [f, sha256(readFileSync(join(dir, f)))])),
    };
  }
  return { skills, problems, count: Object.keys(skills).length };
}

const { skills, problems, count } = collect();

if (update) {
  const lock = {
    $comment:
      '固化技能的版本与校验和。改动 .dsh/skills/ 下任何文件后运行 node scripts/verify-skills.mjs --update 并提交本文件。',
    skillCount: count,
    skills,
  };
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  console.log(`已写入 ${relative(root, lockPath)}：${count} 个技能`);
  if (problems.length) {
    console.error('结构问题：');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  process.exit(0);
}

if (!existsSync(lockPath)) {
  console.error(`缺少 ${relative(root, lockPath)}；先运行 node scripts/verify-skills.mjs --update`);
  process.exit(2);
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const findings = [...problems];

for (const [name, entry] of Object.entries(skills)) {
  const expected = lock.skills?.[name];
  if (!expected) {
    findings.push(`${name}: 出现在 .dsh/skills/ 但不在 lock 中（新增了技能？运行 --update）`);
    continue;
  }
  if (expected.version !== entry.version || expected.source !== entry.source) {
    findings.push(
      `${name}: 版本/来源与 lock 不一致（lock ${expected.version} ← 当前 ${entry.version}）`,
    );
  }
  for (const [file, hash] of Object.entries(entry.files)) {
    if (!(file in expected.files)) findings.push(`${name}/${file}: 新增文件，lock 中不存在`);
    else if (expected.files[file] !== hash)
      findings.push(`${name}/${file}: 内容被修改（哈希不匹配）`);
  }
  for (const file of Object.keys(expected.files ?? {})) {
    if (!(file in entry.files)) findings.push(`${name}/${file}: 文件缺失`);
  }
}

for (const name of Object.keys(lock.skills ?? {})) {
  if (!(name in skills)) findings.push(`${name}: lock 中有，但 .dsh/skills/ 下不存在`);
}

if (findings.length) {
  console.error(`固化技能与 lock 不一致（${findings.length} 项）：`);
  for (const f of findings) console.error('  - ' + f);
  console.error('\n技能正文不许在项目里改。确需升级：改完运行 --update 并在同一个提交里说明来源。');
  process.exit(1);
}

console.log(`OK：${count} 个固化技能与 lock 一致`);
