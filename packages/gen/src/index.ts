
import prompts from 'prompts';
import minimist from 'minimist';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blue,
  cyan,
  green,
  lightGreen,
  lightRed,
  magenta,
  red,
  reset,
  yellow,
} from 'kolorist'


const cwd = process.cwd();
type ColorFunc = (str: string | number) => string
type Framework = {
  name: string
  display: string
  color: ColorFunc
  variants: FrameworkVariant[]
}
type FrameworkVariant = {
  name: string
  display: string
  color: ColorFunc
  customCommand?: string
}
const FRAMEWORKS: Framework[] = [
  {
    name: 'vue',
    display: 'Vue',
    color: green,
    variants: [
      {
        name: 'vue',
        display: 'JavaScript',
        color: yellow,
      },
      {
        name: 'vue-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'custom-create-vue',
        display: 'Customize with create-vue ↗',
        color: green,
        customCommand: 'npm create vue@latest TARGET_DIR',
      },
      {
        name: 'custom-nuxt',
        display: 'Nuxt ↗',
        color: lightGreen,
        customCommand: 'npm exec nuxi init TARGET_DIR',
      },
    ],
  }
];
const TEMPLATES = FRAMEWORKS.map((f) => {
  return f.variants && f.variants.map(v => {
    return v.name;
  }) || [f.name];
}).reduce((a, b) => a.concat(b), []);

const argv = minimist<{
  t?: string
  template?: string
}>(process.argv.slice(2), { string: ['_'] });


(async () => {
  const defaultTargetDir = 'vite-project';
  const argTargetDir = formatTargetDir(argv._[0]);
  const argTemplate = argv.template || argv.t; // 什么类型的模板
  let targetDir = argTargetDir || defaultTargetDir; // 项目生成的目录
  const getProjectName = () =>
    targetDir === '.' ? path.basename(path.resolve()) : targetDir

  let result: prompts.Answers<'projectName' | 'overwrite' | 'packageName' | 'framework' | 'variant'>;
  try {
    result = await prompts([
      {
        type: argTargetDir ? null : 'text',
        name: 'projectName',
        message: 'Project name:',
        initial: defaultTargetDir,
        onState: (state) => {
          // 这里防止用户输入的目录名是空字符串
          targetDir = formatTargetDir(state.value) || defaultTargetDir;
        },
      },
      {
        // 用户选择的目录可能已经存在并且有内容
        type: () => {
          if (!fs.existsSync(targetDir) || isEmpty(targetDir)) {
            return null;
          } else {
            return 'confirm';
          }
        },
        name: 'overwrite',
        message: () =>
          (targetDir === '.'
            ? 'Current directory'
            : `Target directory "${targetDir}"`) + ` is not empty. Remove existing files and continue?`,
      },
      {
        type: (_, { overwrite }: { overwrite?: boolean }) => {
          if (overwrite === false) {
            throw new Error(red('✖') + ' Operation cancelled');
          }
          return null;
        },
        name: 'overwriteChecker',
      },
      {
        type: 'text',
        name: 'packageName',
        message: 'Package name:',
        initial: defaultTargetDir,
      },
      {
        type: argTemplate && TEMPLATES.includes(argTemplate) ? null : 'select',
        name: 'framework',
        message:
          typeof argTemplate === 'string' && !TEMPLATES.includes(argTemplate)
            ? reset(
              `"${argTemplate}" isn't a valid template. Please choose from below: `,
            )
            : reset('Select a framework:'),
        initial: 0,
        choices: FRAMEWORKS.map((framework) => {
          const frameworkColor = framework.color;

          return {
            title: frameworkColor(framework.display || framework.name),
            value: framework,
          }
        }),
      },
      {
        type: (framework: Framework) =>
          framework && framework.variants ? 'select' : null,
        name: 'variant',
        message: reset('Select a variant:'),
        choices: (framework: Framework) =>
          framework.variants.map((variant) => {
            const variantColor = variant.color;
            return {
              title: variantColor(variant.display || variant.name),
              value: variant.name,
            }
          }),
      }
    ], {
      onCancel: () => {
        throw new Error(red('✖') + ' Operation cancelled')
      },
    });
  } catch (error) {
    console.log(error);
    return;
  }
  const { framework, overwrite, packageName, variant } = result;
  console.log(result);
  const root = path.join(cwd, targetDir);
  if (overwrite) {
    emptyDir(root);
  } else if (!fs.existsSync(root)) {
    fs.mkdirSync(root, {recursive: true});
  }
  let template: string = variant || framework?.name || argTemplate;
  // 只是为了理解代码，只有 template-vue-ts 模板
  template = 'vue-ts';
  // 使用 pnpm create gen，process.env.npm_config_user_agent 打印输出 npm/8.19.3 node/v16.19.0 darwin x64 workspaces/false
  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent);
  console.log('>>> process.env.npm_config_user_agent', process.env.npm_config_user_agent);
  const pkgManager = pkgInfo ? pkgInfo.name : 'npm'
  // 模板目录
  const templateDir = path.resolve(
    fileURLToPath(import.meta.url),
    '../..', // 当前文件打包后在 dist/index.js
    `template-${template}`
  );

  // 将模板拷贝到用户指定的目录中去
  const renameFiles: Record<string, string | undefined> = {
    _gitignore: '.gitignore',
  }
  const write = (file: string, content?: string) => {
    const targetPath = path.join(root, renameFiles[file] ?? file);
    if (content) {
      fs.writeFileSync(targetPath, content);
    } else {
      copy(path.join(templateDir, file), targetPath)
    }
  }

  const files = fs.readdirSync(templateDir);
  // package.json 需要其他的处理，暂时不写入
  for (const file of files.filter(f => f !== 'package.json')) {
    write(file);
  }

  const pkg = JSON.parse(
    fs.readFileSync(path.join(templateDir, 'package.json'), 'utf-8')
  );
  pkg.name = packageName || getProjectName()
  write('package.json', JSON.stringify(pkg, null, 2) + '\n')
  const cdProjectName = path.relative(cwd, root)
  console.log(`\nDone. Now run:\n`);

  // 提示目录跳转
  if (root !== cwd) {
    console.log(
      `  cd ${
        cdProjectName.includes(' ') ? `"${cdProjectName}"` : cdProjectName
      }`,
    )
  }

  switch (pkgManager) {
    case 'yarn':
      console.log('  yarn')
      console.log('  yarn dev')
      break
    default:
      console.log(`  ${pkgManager} install`)
      console.log(`  ${pkgManager} run dev`)
      break
  }


})();

function copy(src: string, dest: string) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    copyDir(src, dest);
  } else {
    fs.copyFileSync(src, dest);
  }
}


function copyDir(srcDir: string, destDir: string) {
  fs.mkdirSync(destDir, { recursive: true});
  for (const file of fs.readdirSync(srcDir)) {
    const srcFile = path.resolve(srcDir, file);
    const destFile = path.resolve(destDir, file);
    copy(srcFile, destFile);
  }
}

function pkgFromUserAgent(userAgent: string | undefined) {
  if (!userAgent) return undefined
  const pkgSpec = userAgent.split(' ')[0]
  const pkgSpecArr = pkgSpec.split('/')
  return {
    name: pkgSpecArr[0],
    version: pkgSpecArr[1],
  }
}
function formatTargetDir(targetDir: string | undefined) {
  return targetDir?.trim().replace(/\/+$/g, '')
}

function isEmpty(path: string) {
  const files = fs.readdirSync(path);
  return files.length === 0 || (files.length === 1 && files[0] === '.git');
}

function isValidPackageName(projectName: string) {
  return /^(?:@[a-z\d\-*~][a-z\d\-*._~]*\/)?[a-z\d\-~][a-z\d\-._~]*$/.test(
    projectName,
  )
}

function emptyDir(dir: string) {
  if (!fs.existsSync(dir)) {
    return
  }
  for (const file of fs.readdirSync(dir)) {
    if (file === '.git') {
      continue
    }
    fs.rmSync(path.resolve(dir, file), { recursive: true, force: true })
  }
}