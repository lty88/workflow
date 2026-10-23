import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'vue/compiler-sfc';
import ts from 'typescript';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const failures = [];
let pageCount = 0;
let sourceCount = 0;

/**
 * 枚举前端源码目录，按文件类型收集结构检查目标。
 * @param directory 当前源码目录
 * @returns 当前目录及子目录的源码文件绝对路径
 */
async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(path)));
    else if (/\.(vue|tsx?|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) result.push(path);
  }
  return result;
}

/**
 * 检查模块导入方向，页面是入口，组件不反向依赖业务视图，接口不依赖页面状态。
 * @param file 当前源码相对路径
 * @param source 组件脚本或普通模块内容
 */
function inspectImports(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    const target = specifier.text;
    if (target.startsWith('../')) failures.push(`${file}：跨目录导入请使用 @/：${target}`);
    if (target === '@/api') failures.push(`${file}：请从 api 对应业务模块导入接口`);
    if (target.startsWith('@/pages/')) failures.push(`${file}：业务模块不能导入路由入口`);
    if (file.startsWith('pages/') && /^@\/(api|stores)\//.test(target))
      failures.push(`${file}：接口或状态逻辑请移至 views 或业务组件`);
    if (file.startsWith('components/') && target.startsWith('@/views/'))
      failures.push(`${file}：业务组件不能反向依赖 views`);
    if (file.startsWith('api/') && /^@\/(pages|views|components|stores|navigation)\//.test(target))
      failures.push(`${file}：接口模块不能依赖页面、组件、导航或状态层`);
  }
}

for (const path of await sourceFiles(sourceRoot)) {
  const file = relative(sourceRoot, path).split(sep).join('/');
  const source = await readFile(path, 'utf8');
  sourceCount += 1;
  if (file.startsWith('pages/')) {
    pageCount += 1;
    if (source.trimEnd().split('\n').length > 40)
      failures.push(`${file}：路由入口超过 40 行，请将业务职责移至 views 或组件`);
  }
  if (file.endsWith('.vue')) {
    const { descriptor, errors } = parse(source, { filename: file });
    if (errors.length) failures.push(`${file}：Vue 单文件组件解析失败`);
    if (descriptor.scriptSetup?.lang !== 'tsx') failures.push(`${file}：统一使用 script setup lang="tsx"`);
    inspectImports(file, descriptor.scriptSetup?.content || '');
  } else inspectImports(file, source);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `前端结构检查通过：${pageCount} 个路由入口、${sourceCount} 个源码文件，入口职责与导入方向符合约定。`,
  );
}
