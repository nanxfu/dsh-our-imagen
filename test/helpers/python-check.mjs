/**
 * Python 打包产物的离线语法与自包含导入校验工具。
 */

import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

/** 本机可用的 python 命令；没有就返回 null（语法编译按任务约定跳过并注明）。 */
export function pythonCommand() {
  for (const name of ['python', 'python3']) {
    const result = spawnSync(name, ['--version'], { encoding: 'utf8', windowsHide: true })
    if (result.status === 0) return name
  }
  return null
}

/** 用 python 的 compile() 做语法检查（只编译不执行，不 import torch）。 */
export function assertPythonSyntax(filePath) {
  const python = pythonCommand()
  if (!python) {
    console.log('  （跳过 python 语法编译：本机没有 python / python3）')
    return
  }
  const script =
    'import sys; compile(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1], "exec")'
  const result = spawnSync(python, ['-c', script, filePath], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`python 语法编译失败：${result.stderr || result.stdout}`)
}

/**
 * 在临时目录里 import 打包产物，验证它确实是单文件自包含。
 *
 * 只执行模块顶层代码，不 import torch、不联网；模块自身若还有未内联的本地依赖会直接 ImportError。
 */
export function assertPythonImports(filePath, symbolNames, moduleName = 'packaged_under_test') {
  const python = pythonCommand()
  if (!python) {
    console.log('  （跳过 python 导入自检：本机没有 python / python3）')
    return
  }
  const script = [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location(sys.argv[1], sys.argv[2])',
    'module = importlib.util.module_from_spec(spec)',
    'sys.modules[spec.name] = module',
    'spec.loader.exec_module(module)',
    'missing = [name for name in sys.argv[3:] if not hasattr(module, name)]',
    'sys.exit("缺少符号: " + ",".join(missing) if missing else 0)',
  ].join('\n')
  const result = spawnSync(python, ['-c', script, moduleName, filePath, ...symbolNames], {
    encoding: 'utf8',
    windowsHide: true,
    cwd: tmpdir(),
  })
  if (result.status !== 0) throw new Error(`python 隔离导入失败（未自包含）：${result.stderr || result.stdout}`)
}
