window.__ModuleLoader__.load({
  id: 'dsh-our-free-imagen',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'our-free-imagen'

    /**
     * 前端文案字典（zh / en 键集合必须完全一致，验收脚本会逐键比对）。
     * 键名以 docs/API.md 第 7 节为准；第 7 节未列出、但本工作台需要的键
     * 在两侧同时补充，不单边新增。
     */
    const DICT = {
      zh: {
        'nav.label': '免费生图工作台',
        'page.title': '免费生图工作台',
        'page.subtitle': '基于 Kaggle 免费 GPU 算力运行开源生图模型，支持秒级快速出图。',
        'action.probe': '检查环境',
        'action.probing': '检查中…',
        'status.account': '账号接入',
        'status.quota': 'GPU 配额',
        'status.session': '会话',
        'status.defaultModel': '默认模型',
        'value.unknown': '未检查',
        'value.checking': '—',
        'value.ok': '正常',
        'value.failed': '失败',
        'value.quotaUnavailable': '不可用',
        'value.sessionAbsent': '未启动',
        'guide.title': '接入引导',
        'guide.step1': '1 · 安装 kaggle CLI',
        'guide.step2': '2 · 写入 API token',
        'guide.step3': '3 · 确认手机验证',
        'guide.step4': '4 · 启动 GPU',
        'guide.hint1': '执行 pip install -U kaggle',
        'guide.hint2': '在 Kaggle 设置页生成 token，写入 ~/.kaggle/access_token',
        'guide.hint3': '未验证手机号时任务会静默降级到 CPU',
        'guide.hint4': '排队可能十余分钟，热态后单张秒级',
        'models.title': '模型卡',
        'models.params': '参数',
        'models.download': '权重',
        'models.gpus': '所需卡数',
        'models.steady': '稳态出图',
        'models.pending': '待测',
        'models.license.restricted': '许可受限',
        'models.tier.fast': '快档',
        'models.tier.usable': '可用档',
        'models.tier.pending': '待测',
        'unit.card': '卡',
        'unit.second': '秒',
        'unit.min': '分',
        'unit.image': '张',
        'chip.offline': '生图未就绪',
        'chip.online': '生图就绪',
        'note.m2': '模型数据与显存占用均来自 Kaggle T4 实测基准（详见 docs/MODELS_AND_BENCHMARKS.md）。',
        'workbench.title': '免费生图工作台',
        'workbench.subtitle': '用 Kaggle 免费 GPU 跑开源生图模型：首次启动要排队，热态后 1024 出图只需数秒。',
        'workbench.prompt': '提示词',
        'workbench.promptPlaceholder': '描述画面内容，Ctrl+Enter 提交',
        'workbench.negative': '反向提示词',
        'workbench.negativePlaceholder': '要排除的内容，例如 blurry, low quality',
        'workbench.preset': '预设',
        'workbench.size': '尺寸',
        'workbench.width': '宽',
        'workbench.height': '高',
        'workbench.steps': '步数',
        'workbench.cfg': 'CFG',
        'workbench.seed': '种子',
        'workbench.count': '张数',
        'workbench.random': '随机',
        'workbench.generate': '生成',
        'workbench.generating': '提交中…',
        'workbench.startSession': '启动会话',
        'workbench.stopSession': '关闭会话',
        'workbench.starting': '启动中…',
        'workbench.stopping': '关闭中…',
        'workbench.sessionHint': '会话保持期间可连续出图；空闲超过上限会自动退出。',
        'workbench.gallery': '结果',
        'workbench.galleryEmpty': '提交提示词后，生成结果会显示在这里。',
        'workbench.history': '历史',
        'workbench.historyEmpty': '还没有历史产物。',
        'workbench.openFolder': '复制路径',
        'workbench.error': '出错了',
        'workbench.retry': '重试',
        'workbench.errorDetails': '错误详情',
        'workbench.expand': '展开',
        'workbench.collapse': '收起',
        'workbench.loadMore': '加载更多',
        'workbench.loading': '加载中…',
        'workbench.noMore': '没有更多了',
        'workbench.restartSession': '重新启动会话',
        'workbench.sessionEnded': '会话已结束',
        'workbench.copied': '已复制',
        'workbench.copyFallback': '已选中路径，按 Ctrl+C 复制',
        'workbench.elapsed': '已用',
        'workbench.needPrompt': '先写提示词',
        'workbench.close': '关闭',
        'workbench.kernel': '内核',
        'workbench.escClose': 'Esc 关闭',
        'session.state.absent': '未启动',
        'session.state.provisioning': '排队中',
        'session.state.connecting': '建立隧道',
        'session.state.warming': '模型加载中',
        'session.state.ready': '就绪',
        'session.state.stopping': '正在关机',
        'session.state.error': '失败',
        'session.phase.push': '推送内核',
        'session.phase.queue': 'Kaggle 排队',
        'session.phase.tunnel': '等待隧道',
        'session.phase.health': '健康检查',
        'session.phase.warm': '模型预热',
        'session.endedHint': '内核已结束，重新启动会话后可继续出图。',
        'job.status.queued': '排队中',
        'job.status.waiting-session': '等待会话',
        'job.status.running': '生成中',
        'job.status.done': '完成',
        'job.status.failed': '失败',
        'error.network': '本地服务暂无响应，正在自动重试。',
        'error.http': '请求失败',
        'error.code.need_prompt': '先写提示词',
        'error.code.cli_missing': '未安装 kaggle CLI',
        'error.code.auth_required': '缺少 kaggle 凭据',
        'error.code.push_failed': '内核推送失败',
        'error.code.queue_timeout': 'Kaggle 排队超时',
        'error.code.tunnel_timeout': '隧道没有建立',
        'error.code.health_failed': '远端健康检查未通过',
        'error.code.remote_error': '远端守护进程报错',
        'error.code.stopped': '会话已关闭',
        'error.code.session_ended': '远端会话已结束',
        'error.code.warming': '远端仍在加载模型，稍后重试',
        'error.code.oom': '显存不足',
        'error.code.load_failed': '模型加载失败',
        'error.code.invalid_request': '请求参数不符合远端要求',
        'error.code.generation_failed': '生成失败',
      },
      en: {
        'nav.label': 'Free imagen',
        'page.title': 'Free imagen workbench',
        'page.subtitle': 'Run open image models on free Kaggle GPUs with second-level turnaround.',
        'action.probe': 'Check environment',
        'action.probing': 'Checking…',
        'status.account': 'Account',
        'status.quota': 'GPU quota',
        'status.session': 'Session',
        'status.defaultModel': 'Default model',
        'value.unknown': 'Not checked',
        'value.checking': '—',
        'value.ok': 'Ready',
        'value.failed': 'Failed',
        'value.quotaUnavailable': 'Unavailable',
        'value.sessionAbsent': 'Not started',
        'guide.title': 'Setup guide',
        'guide.step1': '1 · Install kaggle CLI',
        'guide.step2': '2 · Write the API token',
        'guide.step3': '3 · Verify phone',
        'guide.step4': '4 · Start the GPU',
        'guide.hint1': 'Run pip install -U kaggle',
        'guide.hint2': 'Create a token in Kaggle settings, write it to ~/.kaggle/access_token',
        'guide.hint3': 'Without phone verification Kaggle silently falls back to CPU',
        'guide.hint4': 'Queue can take tens of minutes; once warm, images take seconds',
        'models.title': 'Model cards',
        'models.params': 'Params',
        'models.download': 'Weights',
        'models.gpus': 'GPUs',
        'models.steady': 'Steady state',
        'models.pending': 'pending',
        'models.license.restricted': 'restricted license',
        'models.tier.fast': 'fast',
        'models.tier.usable': 'usable',
        'models.tier.pending': 'pending',
        'unit.card': 'GPU',
        'unit.second': 's',
        'unit.min': 'm',
        'unit.image': 'images',
        'chip.offline': 'Imagen not ready',
        'chip.online': 'Imagen ready',
        'note.m2': 'Model metrics and memory usage are verified on Kaggle T4 (see docs/MODELS_AND_BENCHMARKS.md).',
        'workbench.title': 'Free imagen workbench',
        'workbench.subtitle': 'Open image models on free Kaggle GPUs. The first start queues for minutes; once warm a 1024 image takes seconds.',
        'workbench.prompt': 'Prompt',
        'workbench.promptPlaceholder': 'Describe the image. Ctrl+Enter to submit.',
        'workbench.negative': 'Negative prompt',
        'workbench.negativePlaceholder': 'What to avoid, e.g. blurry, low quality',
        'workbench.preset': 'Preset',
        'workbench.size': 'Size',
        'workbench.width': 'W',
        'workbench.height': 'H',
        'workbench.steps': 'Steps',
        'workbench.cfg': 'CFG',
        'workbench.seed': 'Seed',
        'workbench.count': 'Images',
        'workbench.random': 'Random',
        'workbench.generate': 'Generate',
        'workbench.generating': 'Submitting…',
        'workbench.startSession': 'Start session',
        'workbench.stopSession': 'Stop session',
        'workbench.starting': 'Starting…',
        'workbench.stopping': 'Stopping…',
        'workbench.sessionHint': 'While the session stays up you can keep generating; it exits after the idle timeout.',
        'workbench.gallery': 'Result',
        'workbench.galleryEmpty': 'Generated images show up here.',
        'workbench.history': 'History',
        'workbench.historyEmpty': 'No saved outputs yet.',
        'workbench.openFolder': 'Copy path',
        'workbench.error': 'Error',
        'workbench.retry': 'Retry',
        'workbench.errorDetails': 'Error details',
        'workbench.expand': 'Expand',
        'workbench.collapse': 'Collapse',
        'workbench.loadMore': 'Load more',
        'workbench.loading': 'Loading…',
        'workbench.noMore': 'No more',
        'workbench.restartSession': 'Restart session',
        'workbench.sessionEnded': 'Session ended',
        'workbench.copied': 'Copied',
        'workbench.copyFallback': 'Path selected — press Ctrl+C',
        'workbench.elapsed': 'Elapsed',
        'workbench.needPrompt': 'Write a prompt first',
        'workbench.close': 'Close',
        'workbench.kernel': 'Kernel',
        'workbench.escClose': 'Esc to close',
        'session.state.absent': 'Not started',
        'session.state.provisioning': 'Queued',
        'session.state.connecting': 'Tunneling',
        'session.state.warming': 'Loading model',
        'session.state.ready': 'Ready',
        'session.state.stopping': 'Stopping',
        'session.state.error': 'Failed',
        'session.phase.push': 'pushing kernel',
        'session.phase.queue': 'Kaggle queue',
        'session.phase.tunnel': 'tunnel rendezvous',
        'session.phase.health': 'health check',
        'session.phase.warm': 'model warm-up',
        'session.endedHint': 'The kernel has ended; restart the session to keep generating.',
        'job.status.queued': 'Queued',
        'job.status.waiting-session': 'Waiting for session',
        'job.status.running': 'Generating',
        'job.status.done': 'Done',
        'job.status.failed': 'Failed',
        'error.network': 'Local service is not responding; retrying automatically.',
        'error.http': 'Request failed',
        'error.code.need_prompt': 'Write a prompt first',
        'error.code.cli_missing': 'kaggle CLI is not installed',
        'error.code.auth_required': 'kaggle credentials are missing',
        'error.code.push_failed': 'Kernel push failed',
        'error.code.queue_timeout': 'Kaggle queue timed out',
        'error.code.tunnel_timeout': 'Tunnel was not established',
        'error.code.health_failed': 'Remote health check failed',
        'error.code.remote_error': 'Remote daemon reported an error',
        'error.code.stopped': 'Session was stopped',
        'error.code.session_ended': 'Remote session ended',
        'error.code.warming': 'Remote daemon is still warming up; retry shortly',
        'error.code.oom': 'GPU ran out of memory',
        'error.code.load_failed': 'Model failed to load',
        'error.code.invalid_request': 'Request was rejected by the daemon',
        'error.code.generation_failed': 'Generation failed',
      },
    }

    function fallbackTranslate(lang) {
      const dict = lang && lang.toLowerCase().startsWith('zh') ? DICT.zh : DICT.en
      return (key) => dict[key] ?? DICT.en[key] ?? key
    }

    function translator(props) {
      if (props && typeof props.t === 'function') return props.t
      return fallbackTranslate(typeof document === 'undefined' ? 'en' : document.documentElement.lang)
    }

    // 现有 CSS token 变量保持原样，不新增主题变量。
    const token = {
      bg: 'var(--dsw-alias-bg-layer-1)',
      bgAlt: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      text: 'var(--dsw-alias-label-primary)',
      textSub: 'var(--dsw-alias-label-secondary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
      brand: 'var(--dsw-alias-brand-primary)',
    }

    const KEYFRAMES = [
      '@keyframes ofi-slide { 0% { transform: translateX(-120%); } 100% { transform: translateX(340%); } }',
      '.ofi-bar-fill { animation: ofi-slide 1.4s ease-in-out infinite; }',
      '@media (prefers-reduced-motion: reduce) { .ofi-bar-fill { animation: none; transform: none; width: 45%; } }',
    ].join('\n')

    const styles = {
      page: { display: 'grid', gap: 14, padding: '2px 0 20px', color: token.text, fontSize: 13 },
      head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
      title: { margin: 0, fontSize: 17, fontWeight: 600, lineHeight: 1.35 },
      subtitle: { margin: '4px 0 0', fontSize: 12, color: token.textSub, lineHeight: 1.6, maxWidth: 680 },
      topBadge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flex: '0 0 auto',
        fontSize: 11.5,
        color: token.textSub,
        border: `1px solid ${token.border}`,
        borderRadius: 999,
        padding: '2px 9px',
        background: token.bg,
        whiteSpace: 'nowrap',
        maxWidth: 220,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      dot: (color) => ({
        width: 7,
        height: 7,
        minWidth: 7,
        borderRadius: 99,
        background: color,
        display: 'inline-block',
      }),
      bar: {
        display: 'grid',
        gap: 8,
        padding: '9px 11px',
        border: `1px solid ${token.border}`,
        borderRadius: 8,
        background: token.bg,
      },
      barRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 },
      barMain: { display: 'grid', gap: 3, flex: '1 1 260px', minWidth: 0 },
      barLine: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flexWrap: 'wrap', overflow: 'hidden' },
      stateText: { fontSize: 13, fontWeight: 600 },
      muted: {
        fontSize: 11.5,
        color: token.textSub,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
        flex: '0 1 auto',
        maxWidth: '100%',
      },
      link: { fontSize: 11.5, color: token.brand, textDecoration: 'none', whiteSpace: 'nowrap' },
      tag: (color) => ({
        fontSize: 10.5,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: '0 6px',
        whiteSpace: 'nowrap',
        lineHeight: 1.6,
      }),
      button: {
        appearance: 'none',
        border: `1px solid ${token.border}`,
        background: token.bgAlt,
        color: token.text,
        borderRadius: 6,
        padding: '4px 10px',
        fontSize: 12,
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      buttonPrimary: {
        appearance: 'none',
        border: `1px solid ${token.brand}`,
        background: token.brand,
        color: token.bg,
        borderRadius: 6,
        padding: '5px 14px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      buttonSmall: {
        appearance: 'none',
        border: `1px solid ${token.border}`,
        background: 'transparent',
        color: token.textSub,
        borderRadius: 5,
        padding: '1px 6px',
        fontSize: 10.5,
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      disabled: { opacity: 0.5, cursor: 'not-allowed' },
      input: {
        boxSizing: 'border-box',
        width: '100%',
        appearance: 'none',
        border: `1px solid ${token.border}`,
        background: token.bg,
        color: token.text,
        borderRadius: 6,
        padding: '5px 8px',
        fontSize: 12,
        lineHeight: 1.5,
        fontFamily: 'inherit',
      },
      numberInput: {
        boxSizing: 'border-box',
        width: '100%',
        appearance: 'none',
        border: `1px solid ${token.border}`,
        background: token.bg,
        color: token.text,
        borderRadius: 6,
        padding: '5px 4px',
        fontSize: 12,
        lineHeight: 1.5,
        textAlign: 'center',
        fontFamily: 'inherit',
      },
      textarea: {
        boxSizing: 'border-box',
        width: '100%',
        appearance: 'none',
        border: `1px solid ${token.border}`,
        background: token.bg,
        color: token.text,
        borderRadius: 6,
        padding: '6px 8px',
        fontSize: 12,
        lineHeight: 1.6,
        resize: 'vertical',
        minHeight: 64,
        fontFamily: 'inherit',
      },
      field: { display: 'grid', gap: 3, minWidth: 0 },
      label: { fontSize: 10.5, color: token.textSub, letterSpacing: 0.2 },
      params: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', alignItems: 'end' },
      sizeRow: { display: 'flex', alignItems: 'center', gap: 4 },
      sizeSep: { fontSize: 11, color: token.textSub },
      section: { display: 'grid', gap: 8 },
      sectionHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, minWidth: 0 },
      sectionTitle: { fontSize: 11.5, fontWeight: 600, color: token.textSub, letterSpacing: 0.4 },
      hint: { fontSize: 10.5, color: token.textSub, whiteSpace: 'nowrap' },
      actions: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      errorBox: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        flexWrap: 'wrap',
        border: `1px solid ${token.error}`,
        borderRadius: 6,
        padding: '5px 9px',
        fontSize: 11.5,
        color: token.text,
        background: token.bg,
      },
      errorText: { color: token.error, minWidth: 0, wordBreak: 'break-word' },
      details: { fontSize: 11, color: token.textSub },
      summary: { cursor: 'pointer', color: token.textSub, fontSize: 11, userSelect: 'none' },
      pre: {
        margin: '6px 0 0',
        padding: '6px 8px',
        border: `1px solid ${token.border}`,
        borderRadius: 6,
        background: token.bgAlt,
        color: token.textSub,
        fontSize: 10.5,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 160,
        overflow: 'auto',
      },
      guide: { display: 'grid', gap: 2, paddingTop: 2 },
      guideRow: { fontSize: 11, color: token.textSub, lineHeight: 1.55 },
      gallery: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' },
      figure: { margin: 0, display: 'grid', gap: 4, minWidth: 0 },
      thumbButton: {
        padding: 0,
        display: 'block',
        lineHeight: 0,
        border: `1px solid ${token.border}`,
        borderRadius: 6,
        overflow: 'hidden',
        background: token.bgAlt,
        cursor: 'zoom-in',
      },
      thumbImg: { display: 'block', width: '100%', height: 'auto', aspectRatio: '1 / 1', objectFit: 'cover' },
      thumbMeta: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 10.5, color: token.textSub },
      progressTrack: {
        position: 'relative',
        height: 3,
        borderRadius: 999,
        background: token.border,
        overflow: 'hidden',
        marginTop: 2,
      },
      progressFill: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '32%',
        height: '100%',
        borderRadius: 999,
        background: token.brand,
      },
      historyCard: { display: 'grid', gap: 4, minWidth: 0 },
      historyPrompt: {
        fontSize: 11,
        color: token.textSub,
        lineHeight: 1.45,
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 2,
        overflow: 'hidden',
        wordBreak: 'break-word',
      },
      thumbPlaceholder: {
        display: 'block',
        aspectRatio: '1 / 1',
        border: `1px dashed ${token.border}`,
        borderRadius: 6,
        color: token.textSub,
        fontSize: 11,
        lineHeight: 1.4,
        padding: 6,
        boxSizing: 'border-box',
        overflow: 'hidden',
      },
      note: { margin: 0, fontSize: 10.5, color: token.textSub, lineHeight: 1.6 },
      overlay: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.74)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 1000,
        cursor: 'zoom-out',
      },
      overlayInner: { display: 'grid', gap: 6, justifyItems: 'center', cursor: 'default', maxWidth: '92vw' },
      overlayImg: {
        maxWidth: '92vw',
        maxHeight: '78vh',
        objectFit: 'contain',
        borderRadius: 4,
        boxShadow: '0 10px 36px rgba(0, 0, 0, 0.5)',
        display: 'block',
      },
      overlayBar: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11.5, color: '#f5f5f5' },
      overlayButton: {
        appearance: 'none',
        border: '1px solid rgba(255, 255, 255, 0.45)',
        background: 'rgba(255, 255, 255, 0.12)',
        color: '#f5f5f5',
        borderRadius: 5,
        padding: '2px 8px',
        fontSize: 11,
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      headerChip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        maxWidth: 96,
        minWidth: 0,
        fontSize: 11,
        color: token.textSub,
        padding: '1px 8px',
        border: `1px solid ${token.border}`,
        borderRadius: 999,
        background: token.bg,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      },
      headerChipText: { overflow: 'hidden', textOverflow: 'ellipsis' },
    }

    const ACTIVE_STATUS = { queued: true, 'waiting-session': true, running: true }
    const TRANSIENT_SESSION = { provisioning: true, connecting: true, warming: true, stopping: true }

    function apiUrl(relative) {
      if (typeof document === 'undefined') return relative
      return new URL(relative, document.baseURI).toString()
    }

    /**
     * 统一请求出口：所有 fetch 都包在 try/catch 里，永远返回结果对象，
     * 不把异常抛到 React 渲染层。网络失败只更新提示，界面保持可用。
     */
    async function request(relative, init) {
      try {
        const res = await fetch(apiUrl(relative), {
          cache: 'no-store',
          credentials: 'same-origin',
          ...init,
          headers: {
            accept: 'application/json',
            ...(init && init.body ? { 'content-type': 'application/json' } : {}),
            ...(init && init.headers ? init.headers : {}),
          },
        })
        let payload = null
        try {
          payload = await res.json()
        } catch {
          payload = null
        }
        if (!res.ok) {
          const envelope = payload && payload.error ? payload.error : null
          return {
            ok: false,
            status: res.status,
            // 远端 daemon 未就绪时 Host 回 503；没有明确错误码就按可重试的 warming 处理。
            code: envelope && envelope.code ? envelope.code : res.status === 503 ? 'warming' : `http_${res.status}`,
            message: envelope && envelope.message ? envelope.message : `HTTP ${res.status}`,
          }
        }
        return { ok: true, status: res.status, data: payload }
      } catch (cause) {
        return {
          ok: false,
          status: 0,
          code: 'network',
          message: String((cause && cause.message) || cause || 'network error'),
        }
      }
    }

    function localized(t, key) {
      const value = t(key)
      return typeof value === 'string' && value !== key ? value : ''
    }

    function sessionStateText(t, state) {
      const key = state ? `session.state.${state}` : 'session.state.absent'
      return localized(t, key) || state || t('value.unknown')
    }

    function jobStatusText(t, status) {
      if (!status) return ''
      return localized(t, `job.status.${status}`) || status
    }

    function phaseText(t, phase) {
      if (!phase) return ''
      return localized(t, `session.phase.${phase}`) || ''
    }

    function sessionColor(state) {
      if (state === 'ready') return token.ok
      if (state === 'error') return token.error
      if (state === 'provisioning' || state === 'connecting' || state === 'warming' || state === 'stopping') return token.warn
      return token.idle
    }

    function jobColor(status) {
      if (status === 'done') return token.ok
      if (status === 'failed') return token.error
      if (status === 'running') return token.brand
      if (status === 'queued' || status === 'waiting-session') return token.warn
      return token.idle
    }

    function errorText(t, error) {
      if (!error) return ''
      if (error.code === 'need_prompt') return t('workbench.needPrompt')
      if (error.code === 'network') return t('error.network')
      const label = localized(t, `error.code.${error.code}`)
      const detail = error.message && error.message !== error.code ? String(error.message) : ''
      if (label && detail) return `${label} · ${detail}`
      if (label) return label
      if (detail) return detail
      return t('error.http')
    }

    function formatDuration(t, ms) {
      const value = Number(ms)
      if (!Number.isFinite(value)) return '—'
      const seconds = Math.max(0, value) / 1000
      if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}${t('unit.second')}`
      const minutes = Math.floor(seconds / 60)
      const rest = Math.round(seconds % 60)
      return rest > 0 ? `${minutes}${t('unit.min')} ${rest}${t('unit.second')}` : `${minutes}${t('unit.min')}`
    }

    function formatSeconds(t, seconds) {
      const value = Number(seconds)
      if (!Number.isFinite(value)) return '—'
      return `${value < 10 ? value.toFixed(1) : Math.round(value)}${t('unit.second')}`
    }

    function jobElapsed(job, now) {
      if (!job) return null
      if (job.status === 'done' || job.status === 'failed') {
        const seconds = Number(job.seconds)
        if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000
        const start = Date.parse(job.startedAt ?? job.createdAt ?? '')
        const end = Date.parse(job.finishedAt ?? '')
        if (Number.isFinite(start) && Number.isFinite(end)) return Math.max(0, end - start)
        return null
      }
      const start = Date.parse(job.startedAt ?? job.createdAt ?? '')
      return Number.isFinite(start) ? Math.max(0, now - start) : null
    }

    function clampInt(value, min, max, fallback) {
      const number = Number(value)
      if (!Number.isFinite(number)) return fallback
      return Math.min(max, Math.max(min, Math.round(number)))
    }

    function clampNumber(value, min, max, fallback) {
      const number = Number(value)
      if (!Number.isFinite(number)) return fallback
      return Math.min(max, Math.max(min, number))
    }

    function clampSize(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return 1024
      return Math.min(1536, Math.max(256, Math.round(number / 8) * 8))
    }

    function parseSeed(text) {
      const raw = String(text ?? '').trim()
      if (!raw) return -1
      const value = Number(raw)
      if (!Number.isFinite(value)) return -1
      const int = Math.trunc(value)
      if (int < 0) return -1
      return Math.min(int, 4294967295)
    }

    function stateJobs(state) {
      return Array.isArray(state && state.jobs) ? state.jobs.filter((job) => job && job.id) : []
    }

    function activeJobOf(state) {
      return stateJobs(state).find((job) => ACTIVE_STATUS[job.status] === true) ?? null
    }

    function pickFocusedJob(state, selectedId, localJob) {
      if (!selectedId) return null
      const jobs = stateJobs(state)
      const fromState = jobs.find((job) => job.id === selectedId)
      if (fromState) return fromState
      if (state && state.lastJob && state.lastJob.id === selectedId) return state.lastJob
      if (localJob && localJob.id === selectedId && jobs.length === 0) return localJob
      return null
    }

    async function copyToClipboard(text) {
      try {
        if (
          typeof navigator !== 'undefined' &&
          navigator.clipboard &&
          typeof navigator.clipboard.writeText === 'function'
        ) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        // 权限缺失或非安全上下文：交给选中文本的兜底路径
      }
      return false
    }

    /**
     * 轮询 Host 状态：有进行中的 job 时 2s，否则 10s；
     * document.hidden 时暂停，恢复可见立即拉一次。
     */
    function useHostState() {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(null)
      const aliveRef = React.useRef(false)
      const refreshRef = React.useRef(() => {})

      React.useEffect(() => {
        aliveRef.current = true
        let stopped = false
        let timer = null

        const clear = () => {
          if (timer !== null) {
            clearTimeout(timer)
            timer = null
          }
        }

        const tick = async () => {
          timer = null
          if (stopped) return
          if (typeof document !== 'undefined' && document.hidden) return
          const result = await request('imagen-api/state', { method: 'GET' })
          if (stopped || !aliveRef.current) return
          let delay = 10000
          if (result.ok && result.data && typeof result.data === 'object') {
            setState(result.data)
            setError(null)
            delay = activeJobOf(result.data) ? 2000 : 10000
          } else {
            setError({ code: result.code, message: result.message })
          }
          timer = setTimeout(tick, delay)
        }

        const onVisible = () => {
          if (typeof document !== 'undefined' && document.hidden) {
            clear()
            return
          }
          clear()
          tick()
        }

        refreshRef.current = () => {
          clear()
          tick()
        }

        tick()
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
        return () => {
          stopped = true
          aliveRef.current = false
          clear()
          refreshRef.current = () => {}
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])

      const refresh = React.useCallback(() => {
        refreshRef.current()
      }, [])

      const patch = React.useCallback((partial) => {
        setState((prev) => (prev ? { ...prev, ...partial } : prev))
      }, [])

      return { state, error, refresh, patch }
    }

    function useNow(enabled) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (!enabled) return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [enabled])
      return now
    }

    function Workbench(props) {
      const t = translator(props)
      const host = useHostState()
      const state = host.state
      const stateError = host.error
      const refresh = host.refresh
      const patch = host.patch

      const aliveRef = React.useRef(true)
      React.useEffect(() => {
        aliveRef.current = true
        return () => {
          aliveRef.current = false
        }
      }, [])

      const session = (state && state.session) || null
      const sessionState = (session && session.state) || 'absent'
      const presets = Array.isArray(state && state.presets) ? state.presets.filter((item) => item && item.id) : []
      const defaultPreset = typeof (state && state.defaultPreset) === 'string' ? state.defaultPreset : ''

      const [prompt, setPrompt] = React.useState('')
      const [negative, setNegative] = React.useState('')
      const [negativeOpen, setNegativeOpen] = React.useState(false)
      const [presetId, setPresetId] = React.useState('')
      const [width, setWidth] = React.useState(1024)
      const [height, setHeight] = React.useState(1024)
      const [steps, setSteps] = React.useState(4)
      const [cfg, setCfg] = React.useState(0)
      const [seed, setSeed] = React.useState('')
      const [count, setCount] = React.useState(1)

      const [sending, setSending] = React.useState(false)
      const [sessionBusy, setSessionBusy] = React.useState('')
      const [probeBusy, setProbeBusy] = React.useState(false)
      const [actionError, setActionError] = React.useState(null)
      const [selectedJobId, setSelectedJobId] = React.useState('')
      const [localJob, setLocalJob] = React.useState(null)
      const [zoom, setZoom] = React.useState(null)
      const [copyState, setCopyState] = React.useState(null)

      const [historyLimit, setHistoryLimit] = React.useState(12)
      const [historyItems, setHistoryItems] = React.useState([])
      const [historyStatus, setHistoryStatus] = React.useState({ loading: false, loaded: false, error: null })
      const [historyToken, setHistoryToken] = React.useState(0)

      const lastBodyRef = React.useRef(null)
      const lastActionRef = React.useRef(null)
      const copyTimerRef = React.useRef(null)
      const fallbackRef = React.useRef(null)

      const preset = presets.find((item) => item.id === presetId) ?? null
      const activeJob = activeJobOf(state)
      // 当前 job 的取用顺序：手动选中的 job → 进行中的 job → 最近一个 job（倒序首位）→ lastJob
      const focusedJob = pickFocusedJob(state, selectedJobId, localJob)
        ?? activeJob
        ?? stateJobs(state)[0]
        ?? (state && state.lastJob)
        ?? null
      const focusedStatus = (focusedJob && focusedJob.status) || ''
      const focusedActive = ACTIVE_STATUS[focusedStatus] === true
      const focusedImages = focusedJob && focusedJob.output && Array.isArray(focusedJob.output.images)
        ? focusedJob.output.images.filter(Boolean)
        : []
      const sessionTransient = TRANSIENT_SESSION[sessionState] === true
      const now = useNow(focusedActive || sessionTransient || sending)

      // 会话侧耗时只统计过渡阶段（排队 / 建隧道 / 载模型 / 关机）。
      let sessionElapsed = null
      if (sessionTransient) {
        const start = Date.parse((session && session.startedAt) || '')
        if (Number.isFinite(start)) sessionElapsed = Math.max(0, now - start)
      }

      // 顶部徽章的耗时：优先当前 job，其次会话过渡阶段。
      let badgeElapsed = null
      if (activeJob) {
        const start = Date.parse(activeJob.startedAt ?? activeJob.createdAt ?? '')
        if (Number.isFinite(start)) badgeElapsed = Math.max(0, now - start)
      } else {
        badgeElapsed = sessionElapsed
      }

      function applyPreset(id) {
        setPresetId(id)
        const next = presets.find((item) => item.id === id)
        if (!next) return
        const size = clampSize(next.size)
        setWidth(size)
        setHeight(size)
        setSteps(clampInt(next.steps, 1, 60, 4))
        setCfg(clampNumber(next.cfg, 0, 20, 0))
      }

      React.useEffect(() => {
        if (presets.length === 0) return
        if (presetId && presets.some((item) => item.id === presetId)) return
        const initial = presets.some((item) => item.id === defaultPreset) ? defaultPreset : presets[0].id
        applyPreset(initial)
      }, [presets.length, defaultPreset, presetId])

      React.useEffect(() => {
        if (!zoom) return undefined
        const onKeyDown = (event) => {
          if (event && event.key === 'Escape') setZoom(null)
        }
        if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown)
        return () => {
          if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown)
        }
      }, [zoom])

      React.useEffect(() => {
        let stopped = false
        const run = async () => {
          setHistoryStatus((prev) => ({ ...prev, loading: true }))
          const result = await request(`imagen-api/history?limit=${historyLimit}`, { method: 'GET' })
          if (stopped || !aliveRef.current) return
          if (result.ok) {
            const items = Array.isArray(result.data && result.data.items) ? result.data.items.filter(Boolean) : []
            setHistoryItems(items)
            setHistoryStatus({ loading: false, loaded: true, error: null })
          } else {
            setHistoryStatus({
              loading: false,
              loaded: true,
              error: { code: result.code, message: result.message },
            })
          }
        }
        run()
        return () => {
          stopped = true
        }
      }, [historyLimit, historyToken])

      const doneSignature = focusedStatus === 'done' && focusedJob
        ? `${focusedJob.id}:${focusedJob.finishedAt ?? ''}`
        : ''
      const lastDoneRef = React.useRef('')
      React.useEffect(() => {
        if (!doneSignature || lastDoneRef.current === doneSignature) return
        lastDoneRef.current = doneSignature
        setHistoryToken((value) => value + 1)
      }, [doneSignature])

      // 任务真正跑起来后清掉上一次操作失败提示，避免旧错误常驻。
      React.useEffect(() => {
        if (focusedActive) setActionError(null)
      }, [focusedActive])

      React.useEffect(() => {
        return () => {
          if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
          copyTimerRef.current = null
          const el = fallbackRef.current
          if (el && el.parentNode) el.parentNode.removeChild(el)
          fallbackRef.current = null
        }
      }, [])

      function selectTextFallback(value) {
        if (typeof document === 'undefined' || !document.body) return
        let el = fallbackRef.current
        if (!el || !el.isConnected) {
          el = document.createElement('textarea')
          el.setAttribute('readonly', 'readonly')
          el.setAttribute('aria-hidden', 'true')
          el.style.position = 'fixed'
          el.style.top = '0'
          el.style.left = '0'
          el.style.width = '1px'
          el.style.height = '1px'
          el.style.opacity = '0'
          el.style.pointerEvents = 'none'
          document.body.appendChild(el)
          fallbackRef.current = el
        }
        el.value = value
        try {
          el.focus()
          el.select()
          if (typeof el.setSelectionRange === 'function') el.setSelectionRange(0, value.length)
        } catch {
          // 选中失败时至少把路径放进剪贴板之外的可见提示里
        }
      }

      async function copyPath(key, text) {
        const value = String(text ?? '').trim()
        if (!value) return
        const ok = await copyToClipboard(value)
        if (!aliveRef.current) return
        if (!ok) selectTextFallback(value)
        setCopyState({ key, mode: ok ? 'ok' : 'select' })
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
        copyTimerRef.current = setTimeout(() => {
          copyTimerRef.current = null
          if (aliveRef.current) setCopyState(null)
        }, 2200)
      }

      function copyLabel(key) {
        if (!copyState || copyState.key !== key) return ''
        return copyState.mode === 'ok' ? t('workbench.copied') : t('workbench.copyFallback')
      }

      function buildBody() {
        const body = {
          prompt: prompt.trim().slice(0, 2000),
          negativePrompt: negative.trim(),
          width: clampSize(width),
          height: clampSize(height),
          steps: clampInt(steps, 1, 60, 4),
          cfg: clampNumber(cfg, 0, 20, 0),
          seed: parseSeed(seed),
          count: clampInt(count, 1, 4, 1),
          waitSeconds: 0,
          autoStart: true,
        }
        const id = presetId || defaultPreset
        if (id) body.presetId = id
        return body
      }

      async function sendGenerate(body) {
        lastActionRef.current = () => sendGenerate(body)
        setSending(true)
        setActionError(null)
        const result = await request('imagen-api/generate', { method: 'POST', body: JSON.stringify(body) })
        if (!aliveRef.current) return
        setSending(false)
        if (result.ok && result.data && result.data.id) {
          setLocalJob(result.data)
          setSelectedJobId(result.data.id)
          setZoom(null)
          refresh()
          return
        }
        setActionError({ code: result.code, message: result.message })
      }

      function submitGenerate() {
        if (sending) return
        const body = buildBody()
        if (!body.prompt) {
          setActionError({ code: 'need_prompt', message: '' })
          return
        }
        lastBodyRef.current = body
        sendGenerate(body)
      }

      function retryGenerate() {
        if (sending) return
        const body = lastBodyRef.current ?? buildBody()
        if (!body.prompt) {
          setActionError({ code: 'need_prompt', message: '' })
          return
        }
        sendGenerate(body)
      }

      async function startSession() {
        if (sessionBusy) return
        lastActionRef.current = () => startSession()
        setSessionBusy('start')
        setActionError(null)
        const payload = {}
        const id = presetId || defaultPreset
        if (id) payload.presetId = id
        const result = await request('imagen-api/session/start', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        if (!aliveRef.current) return
        setSessionBusy('')
        if (result.ok) {
          if (result.data && result.data.session) patch({ session: result.data.session })
          refresh()
          return
        }
        setActionError({ code: result.code, message: result.message })
      }

      async function stopSession() {
        if (sessionBusy) return
        lastActionRef.current = () => stopSession()
        setSessionBusy('stop')
        setActionError(null)
        const result = await request('imagen-api/session/stop', { method: 'POST' })
        if (!aliveRef.current) return
        setSessionBusy('')
        if (result.ok) {
          if (result.data && result.data.session) patch({ session: result.data.session })
          refresh()
          return
        }
        setActionError({ code: result.code, message: result.message })
      }

      async function runProbe() {
        if (probeBusy) return
        lastActionRef.current = () => runProbe()
        setProbeBusy(true)
        const result = await request('imagen-api/probe', { method: 'POST' })
        if (!aliveRef.current) return
        setProbeBusy(false)
        if (result.ok) {
          patch({ probe: (result.data && result.data.probe) || null, probeAt: Date.now() })
          return
        }
        setActionError({ code: result.code, message: result.message })
      }

      function retryLastAction() {
        const action = lastActionRef.current
        if (typeof action === 'function') action()
        else refresh()
      }

      function onPromptKeyDown(event) {
        if (event && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          submitGenerate()
        }
      }

      function onZoomImage(image) {
        if (!image || !image.url) return
        setZoom(image)
      }

      const probe = (state && state.probe) || null
      const accountReady = probe ? probe.auth && probe.auth.ok === true : null
      const accountLabel = accountReady === null ? t('value.unknown') : accountReady ? t('value.ok') : t('value.failed')
      const quotaTotal = probe && probe.quota && probe.quota.totalHours != null ? probe.quota.totalHours : null
      const quotaLabel = probe && probe.quota && probe.quota.available
        ? `${probe.quota.usedHours ?? '?'} / ${quotaTotal ?? '?'} h`
        : probe
          ? t('value.quotaUnavailable')
          : t('value.unknown')

      const canStart = !sessionBusy && (sessionState === 'absent' || sessionState === 'error')
      const canStop = !sessionBusy && sessionState !== 'absent' && sessionState !== 'stopping'
      const kernelUrl = session && typeof session.kernelUrl === 'string' ? session.kernelUrl : ''
      const sessionTag = phaseText(t, session && session.phase)
      const hasSessionError = !!(session && session.error && (session.error.code || session.error.message))
      // 契约补充：session_ended 需要重新启动会话；503 warming 属于可重试状态。
      const sessionErrorCode = (session && session.error && session.error.code) || ''
      const sessionEnded = sessionState === 'error' && sessionErrorCode === 'session_ended'
      const sessionWarming = sessionState === 'error' && sessionErrorCode === 'warming'
      const sessionHeadline = sessionEnded ? t('workbench.sessionEnded') : sessionStateText(t, sessionState)
      const badgeColor = sessionEnded || sessionWarming ? token.warn : sessionColor(sessionState)
      const pageError = actionError || stateError
      const displayError = focusedStatus === 'failed' ? (focusedJob.error ?? { code: '', message: '' }) : null
      const jobEnded = focusedStatus === 'failed' && !!displayError && displayError.code === 'session_ended'

      const badgeTitle = [
        sessionStateText(t, sessionState),
        (session && session.detail) || '',
        activeJob ? jobStatusText(t, activeJob.status) : '',
        accountReady === true ? t('chip.online') : t('chip.offline'),
      ]
        .filter(Boolean)
        .join(' · ')

      const historyHasMore = historyItems.length >= historyLimit

      return h(
        'div',
        { style: styles.page, className: 'ofi-workbench' },
        h('style', { key: 'ofi-keyframes' }, KEYFRAMES),

        // 顶部：标题 + 说明 + 右上角会话徽章
        h(
          'div',
          { style: styles.head },
          h(
            'div',
            { style: { minWidth: 0 } },
            h('h2', { style: styles.title }, t('workbench.title')),
            h('p', { style: styles.subtitle }, t('workbench.subtitle')),
          ),
          h(
            'span',
            { style: styles.topBadge, title: badgeTitle },
            h('span', { style: styles.dot(activeJob ? jobColor(activeJob.status) : badgeColor) }),
            h('span', null, activeJob ? jobStatusText(t, activeJob.status) : sessionHeadline),
            badgeElapsed !== null
              ? h('span', null, `· ${formatDuration(t, badgeElapsed)}`)
              : null,
          ),
        ),

        // 会话条：状态 / 内核链接 / 启动与关机 / 可折叠错误详情
        h(
          'div',
          { style: styles.bar },
          h(
            'div',
            { style: styles.barRow },
            h(
              'div',
              { style: styles.barMain },
              h(
                'div',
                { style: styles.barLine },
                h('span', { style: styles.dot(badgeColor) }),
                h('span', { style: styles.stateText }, sessionHeadline),
                sessionTag ? h('span', { style: styles.tag(token.warn) }, sessionTag) : null,
                session && session.kernelStatus
                  ? h('span', { style: styles.muted }, session.kernelStatus)
                  : null,
              ),
              h(
                'div',
                { style: styles.barLine },
                session && session.detail ? h('span', { style: styles.muted }, session.detail) : null,
                session && session.device ? h('span', { style: styles.muted }, session.device) : null,
                session && session.modelId ? h('span', { style: styles.muted }, session.modelId) : null,
                !session || !session.modelId
                  ? h('span', { style: styles.muted }, `${t('status.defaultModel')} ${defaultPreset || '—'}`)
                  : null,
              ),
            ),
            h(
              'div',
              { style: { ...styles.barLine, flexWrap: 'wrap', justifyContent: 'flex-end', flex: '0 1 auto' } },
              kernelUrl
                ? h(
                    'a',
                    {
                      style: styles.link,
                      href: kernelUrl,
                      target: '_blank',
                      rel: 'noreferrer noopener',
                      title: kernelUrl,
                    },
                    `${t('workbench.kernel')} ↗`,
                  )
                : null,
              h(
                'span',
                { style: styles.tag(accountReady === false ? token.error : accountReady ? token.ok : token.idle) },
                `${t('status.account')} ${accountLabel}`,
              ),
              h('span', { style: styles.tag(token.idle) }, `${t('status.quota')} ${quotaLabel}`),
              h(
                'button',
                {
                  type: 'button',
                  style: { ...styles.button, ...(canStart ? {} : styles.disabled) },
                  onClick: startSession,
                  disabled: !canStart,
                },
                sessionBusy === 'start' ? t('workbench.starting') : t('workbench.startSession'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: { ...styles.button, ...(canStop ? {} : styles.disabled) },
                  onClick: stopSession,
                  disabled: !canStop,
                },
                sessionBusy === 'stop' ? t('workbench.stopping') : t('workbench.stopSession'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: { ...styles.buttonSmall, ...(probeBusy ? styles.disabled : {}) },
                  onClick: runProbe,
                  disabled: probeBusy,
                },
                probeBusy ? t('action.probing') : t('action.probe'),
              ),
            ),
          ),

          sessionState === 'ready' ? h('div', { style: styles.hint }, t('workbench.sessionHint')) : null,

          // 契约补充：session_ended（Kernel 在 ready 后结束）——给"重新启动会话"入口，不按普通失败处理
          sessionEnded
            ? h(
                'div',
                { style: styles.barLine },
                h('span', { style: styles.hint }, t('session.endedHint')),
                h(
                  'button',
                  {
                    type: 'button',
                    style: { ...styles.buttonPrimary, ...(sessionBusy ? styles.disabled : {}) },
                    onClick: startSession,
                    disabled: !!sessionBusy,
                  },
                  sessionBusy === 'start' ? t('workbench.starting') : t('workbench.restartSession'),
                ),
              )
            : null,

          // 契约补充：远端 503 warming 是 daemon 未就绪的兜底，按可重试状态展示
          sessionWarming
            ? h(
                'div',
                { style: styles.barLine },
                h('span', { style: styles.hint }, t('error.code.warming')),
                h('button', { type: 'button', style: styles.buttonSmall, onClick: retryLastAction }, t('workbench.retry')),
              )
            : null,

          // 状态分支 2/5：排队中（provisioning / connecting / warming / stopping 过渡态）——条形指示 + 已等待时长
          sessionTransient
            ? h(
                'div',
                { style: styles.barLine },
                h(
                  'div',
                  { style: { ...styles.progressTrack, flex: '1 1 140px', marginTop: 0 } },
                  h('div', { className: 'ofi-bar-fill', style: styles.progressFill }),
                ),
                h(
                  'span',
                  { style: styles.hint },
                  `${t('workbench.elapsed')} ${formatDuration(t, sessionElapsed)}`,
                ),
              )
            : null,

          // 状态分支 1/5：无会话（absent）——给出接入引导，不叠卡片
          sessionState === 'absent'
            ? h(
                'div',
                { style: styles.guide },
                h('div', { style: styles.guideRow }, `${t('guide.step1')} — ${t('guide.hint1')}`),
                h('div', { style: styles.guideRow }, `${t('guide.step2')} — ${t('guide.hint2')}`),
                h('div', { style: styles.guideRow }, `${t('guide.step3')} — ${t('guide.hint3')}`),
                h('div', { style: styles.guideRow }, `${t('guide.step4')} — ${t('guide.hint4')}`),
              )
            : null,

          // 状态分支 4/5（会话侧）：error 状态与 error 对象都进可折叠详情
          hasSessionError
            ? h(
                'details',
                { style: styles.details },
                h(
                  'summary',
                  { style: styles.summary },
                  `${t('workbench.errorDetails')}${session.error.code ? ` · ${session.error.code}` : ''}`,
                ),
                h(
                  'pre',
                  { style: styles.pre },
                  `${errorText(t, session.error)}\n${JSON.stringify(session.error, null, 2)}`,
                ),
              )
            : null,
        ),

        // 页面级错误（轮询失败或最近一次操作失败）：只提示，不阻塞界面
        pageError
          ? h(
              'div',
              { style: styles.errorBox },
              h('span', { style: styles.errorText }, `${t('workbench.error')} · ${errorText(t, pageError)}`),
              h(
                'button',
                { type: 'button', style: styles.buttonSmall, onClick: retryLastAction },
                t('workbench.retry'),
              ),
            )
          : null,

        // 生成区
        h(
          'div',
          { style: styles.section },
          h(
            'div',
            { style: styles.sectionHead },
            h('span', { style: styles.sectionTitle }, t('workbench.prompt')),
            h('span', { style: styles.hint }, 'Ctrl+Enter'),
          ),
          h('textarea', {
            style: styles.textarea,
            value: prompt,
            placeholder: t('workbench.promptPlaceholder'),
            spellCheck: false,
            onChange: (event) => setPrompt(event.target.value),
            onKeyDown: onPromptKeyDown,
          }),

          h(
            'div',
            { style: styles.barLine },
            h(
              'button',
              { type: 'button', style: styles.buttonSmall, onClick: () => setNegativeOpen((open) => !open) },
              `${t('workbench.negative')} ${negativeOpen ? '▾' : '▸'}`,
            ),
            !negativeOpen && negative.trim() ? h('span', { style: styles.muted }, negative.trim()) : null,
          ),
          negativeOpen
            ? h('textarea', {
                style: { ...styles.textarea, minHeight: 48 },
                value: negative,
                placeholder: t('workbench.negativePlaceholder'),
                spellCheck: false,
                onChange: (event) => setNegative(event.target.value),
              })
            : null,

          h(
            'div',
            { style: styles.params },
            h(
              'label',
              { style: styles.field },
              h('span', { style: styles.label }, t('workbench.preset')),
              h(
                'select',
                {
                  style: styles.input,
                  value: presetId,
                  onChange: (event) => applyPreset(event.target.value),
                  disabled: presets.length === 0,
                },
                ...(presets.length === 0
                  ? [h('option', { key: 'empty', value: '' }, defaultPreset || '—')]
                  : presets.map((item) =>
                      h('option', { key: item.id, value: item.id }, item.label ? `${item.label} · ${item.id}` : item.id),
                    )),
              ),
            ),
            h(
              'label',
              { style: styles.field },
              h('span', { style: styles.label }, t('workbench.size')),
              h(
                'span',
                { style: styles.sizeRow },
                h('input', {
                  style: styles.numberInput,
                  type: 'number',
                  min: 256,
                  max: 1536,
                  step: 8,
                  value: width,
                  'aria-label': t('workbench.width'),
                  onChange: (event) => {
                    const next = Number(event.target.value)
                    if (Number.isFinite(next) && next > 0) setWidth(next)
                  },
                }),
                h('span', { style: styles.sizeSep }, '×'),
                h('input', {
                  style: styles.numberInput,
                  type: 'number',
                  min: 256,
                  max: 1536,
                  step: 8,
                  value: height,
                  'aria-label': t('workbench.height'),
                  onChange: (event) => {
                    const next = Number(event.target.value)
                    if (Number.isFinite(next) && next > 0) setHeight(next)
                  },
                }),
              ),
            ),
            h(
              'label',
              { style: styles.field },
              h('span', { style: styles.label }, t('workbench.steps')),
              h('input', {
                style: styles.numberInput,
                type: 'number',
                min: 1,
                max: 60,
                step: 1,
                value: steps,
                onChange: (event) => {
                  const next = Number(event.target.value)
                  if (Number.isFinite(next) && next >= 1) setSteps(next)
                },
              }),
            ),
            h(
              'label',
              { style: styles.field },
              h('span', { style: styles.label }, t('workbench.cfg')),
              h('input', {
                style: styles.numberInput,
                type: 'number',
                min: 0,
                max: 20,
                step: 0.5,
                value: cfg,
                onChange: (event) => {
                  const next = Number(event.target.value)
                  if (Number.isFinite(next) && next >= 0) setCfg(next)
                },
              }),
            ),
            h(
              'label',
              { style: styles.field },
              h('span', { style: styles.label }, t('workbench.seed')),
              h('input', {
                style: styles.input,
                type: 'text',
                inputMode: 'numeric',
                value: seed,
                placeholder: t('workbench.random'),
                onChange: (event) => setSeed(event.target.value),
              }),
            ),
            h(
              'label',
              { style: styles.field },
              h('span', { style: styles.label }, t('workbench.count')),
              h(
                'select',
                {
                  style: styles.input,
                  value: String(count),
                  onChange: (event) => setCount(Number(event.target.value)),
                },
                ...[1, 2, 3, 4].map((value) => h('option', { key: value, value: String(value) }, String(value))),
              ),
            ),
          ),

          preset
            ? h(
                'div',
                { style: styles.barLine },
                h('span', { style: styles.tag(preset.licenseKind === 'open' ? token.ok : token.warn) },
                  preset.licenseKind === 'open' ? preset.license : t('models.license.restricted')),
                h('span', { style: styles.tag(token.idle) },
                  localized(t, `models.tier.${preset.tier}`) || t('models.tier.pending')),
                h('span', { style: styles.muted },
                  `${t('models.params')} ${preset.params} · ${t('models.download')} ${preset.downloadGb} GB · `
                    + `${t('models.gpus')} ${preset.gpus}${t('unit.card')} · ${t('models.steady')} `
                    + (preset.steadySeconds == null
                      ? t('models.pending')
                      : `${preset.steadySeconds}${t('unit.second')}`)),
              )
            : null,

          h(
            'div',
            { style: styles.actions },
            h(
              'button',
              {
                type: 'button',
                style: { ...styles.buttonPrimary, ...(sending ? styles.disabled : {}) },
                onClick: submitGenerate,
                disabled: sending,
              },
              sending ? t('workbench.generating') : t('workbench.generate'),
            ),
            activeJob ? h('span', { style: styles.hint }, jobStatusText(t, activeJob.status)) : null,
          ),
        ),

        // 结果区
        h(
          'div',
          { style: styles.section },
          h(
            'div',
            { style: styles.sectionHead },
            h('span', { style: styles.sectionTitle }, t('workbench.gallery')),
            focusedJob
              ? h(
                  'span',
                  { style: styles.muted, title: focusedJob.stage || '' },
                  [focusedJob.id, focusedStatus === 'done' ? formatSeconds(t, focusedJob.seconds) : '']
                    .filter(Boolean)
                    .join(' · '),
                )
              : null,
          ),

          // 状态分支 3/5：生成中（job.status 为 queued / waiting-session / running）
          focusedActive
            ? h(
                'div',
                { style: styles.bar },
                h(
                  'div',
                  { style: styles.barLine },
                  h('span', { style: styles.dot(jobColor(focusedStatus)) }),
                  h('span', { style: styles.stateText }, jobStatusText(t, focusedStatus)),
                  h('span', { style: styles.muted },
                    `${t('workbench.elapsed')} ${formatDuration(t, jobElapsed(focusedJob, now))}`),
                  focusedJob.params && focusedJob.params.prompt
                    ? h('span', { style: styles.muted }, focusedJob.params.prompt)
                    : null,
                ),
                h(
                  'div',
                  { style: styles.progressTrack },
                  h('div', { className: 'ofi-bar-fill', style: styles.progressFill }),
                ),
              )
            : null,

          // 状态分支 4/5：失败（job.status === failed）
          focusedStatus === 'failed'
            ? h(
                'div',
                { style: styles.errorBox },
                h('span', { style: styles.errorText },
                  `${t('workbench.error')} · ${errorText(t, displayError)}`),
                // job 因内核结束而失败时，给重新启动入口；其余失败走原样重试
                jobEnded
                  ? h('span', { style: styles.hint }, t('session.endedHint'))
                  : null,
                jobEnded
                  ? h(
                      'button',
                      {
                        type: 'button',
                        style: { ...styles.buttonSmall, ...(sessionBusy ? styles.disabled : {}) },
                        onClick: startSession,
                        disabled: !!sessionBusy,
                      },
                      sessionBusy === 'start' ? t('workbench.starting') : t('workbench.restartSession'),
                    )
                  : h('button', { type: 'button', style: styles.buttonSmall, onClick: retryGenerate }, t('workbench.retry')),
              )
            : null,

          // 状态分支 5/5：完成（job.status === done 且有图片）
          focusedStatus === 'done' && focusedImages.length > 0
            ? h(
                'div',
                { style: styles.gallery },
                ...focusedImages.map((image, index) => {
                  const key = image.path || image.file || `img-${index}`
                  const note = copyLabel(key)
                  return h(
                    'figure',
                    { key, style: styles.figure },
                    h(
                      'button',
                      {
                        type: 'button',
                        style: styles.thumbButton,
                        onClick: () => onZoomImage(image),
                        title: image.file || '',
                      },
                      h('img', {
                        src: image.url,
                        alt: image.file || `image ${index + 1}`,
                        loading: 'lazy',
                        style: styles.thumbImg,
                      }),
                    ),
                    h(
                      'figcaption',
                      { style: styles.thumbMeta },
                      h('span', null, `${t('workbench.seed')} ${image.seed ?? '—'}`),
                      h('span', null, '·'),
                      h('span', null, formatSeconds(t, image.seconds)),
                      h(
                        'button',
                        {
                          type: 'button',
                          style: styles.buttonSmall,
                          onClick: () => copyPath(key, image.path || image.file),
                          title: image.path || image.file || '',
                        },
                        t('workbench.openFolder'),
                      ),
                      note ? h('span', { style: styles.muted }, note) : null,
                    ),
                  )
                }),
              )
            : null,

          // 无结果占位（无会话 / 排队 / 生成中都复用同一句说明）
          !focusedActive && !(focusedStatus === 'done' && focusedImages.length > 0) && focusedStatus !== 'failed'
            ? h('div', { style: styles.note }, t('workbench.galleryEmpty'))
            : null,
        ),

        // 历史区：网格缩略图 + prompt 两行截断 + 加载更多
        h(
          'div',
          { style: styles.section },
          h(
            'div',
            { style: styles.sectionHead },
            h('span', { style: styles.sectionTitle }, t('workbench.history')),
            historyStatus.loading
              ? h('span', { style: styles.hint }, t('workbench.loading'))
              : historyItems.length > 0
                ? h('span', { style: styles.hint }, String(historyItems.length))
                : null,
          ),

          historyStatus.error
            ? h(
                'div',
                { style: styles.errorBox },
                h('span', { style: styles.errorText }, errorText(t, historyStatus.error)),
                h(
                  'button',
                  { type: 'button', style: styles.buttonSmall, onClick: () => setHistoryToken((value) => value + 1) },
                  t('workbench.retry'),
                ),
              )
            : null,

          historyItems.length === 0 && historyStatus.loaded && !historyStatus.error
            ? h('div', { style: styles.note }, t('workbench.historyEmpty'))
            : null,

          historyItems.length > 0
            ? h(
                'div',
                { style: styles.gallery },
                ...historyItems.map((item, index) => {
                  const images = Array.isArray(item.images) ? item.images.filter(Boolean) : []
                  const first = images[0] || null
                  const itemKey = item.jobId || item.dir || `history-${index}`
                  const caption = item.prompt || '—'
                  return h(
                    'div',
                    { key: itemKey, style: styles.historyCard },
                    first
                      ? h(
                          'button',
                          {
                            type: 'button',
                            style: styles.thumbButton,
                            onClick: () => onZoomImage(first),
                            title: item.dir || item.jobId || '',
                          },
                          h('img', {
                            src: first.url,
                            alt: caption.slice(0, 60),
                            loading: 'lazy',
                            style: styles.thumbImg,
                          }),
                        )
                      : h('div', { style: styles.thumbPlaceholder }, item.dir || item.jobId || '—'),
                    h('div', { style: styles.historyPrompt, title: caption }, caption),
                    h(
                      'div',
                      { style: styles.thumbMeta },
                      item.presetId ? h('span', null, item.presetId) : null,
                      images.length > 0 ? h('span', null, `${images.length} ${t('unit.image')}`) : null,
                    ),
                  )
                }),
              )
            : null,

          historyItems.length > 0
            ? h(
                'div',
                { style: styles.actions },
                historyHasMore || historyStatus.loading
                  ? h(
                      'button',
                      {
                        type: 'button',
                        style: { ...styles.button, ...(historyStatus.loading ? styles.disabled : {}) },
                        onClick: () => setHistoryLimit((value) => value + 12),
                        disabled: historyStatus.loading,
                      },
                      historyStatus.loading ? t('workbench.loading') : t('workbench.loadMore'),
                    )
                  : h('span', { style: styles.hint }, t('workbench.noMore')),
              )
            : null,
        ),

        // 放大浮层：固定定位，Esc / 点击背景关闭
        zoom
          ? h(
              'div',
              { style: styles.overlay, onClick: () => setZoom(null), role: 'presentation' },
              h(
                'div',
                {
                  style: styles.overlayInner,
                  onClick: (event) => {
                    if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
                  },
                },
                h('img', { src: zoom.url, alt: zoom.file || '', style: styles.overlayImg }),
                h(
                  'div',
                  { style: styles.overlayBar },
                  h('span', null, `${t('workbench.seed')} ${zoom.seed ?? '—'} · ${formatSeconds(t, zoom.seconds)}`),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: styles.overlayButton,
                      onClick: () => copyPath(zoom.path || zoom.file, zoom.path || zoom.file),
                    },
                    t('workbench.openFolder'),
                  ),
                  copyLabel(zoom.path || zoom.file)
                    ? h('span', null, copyLabel(zoom.path || zoom.file))
                    : null,
                  h('span', { style: { opacity: 0.7 } }, t('workbench.escClose')),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: styles.overlayButton,
                      onClick: () => setZoom(null),
                      'aria-label': t('workbench.close'),
                      title: t('workbench.close'),
                    },
                    '×',
                  ),
                ),
              ),
            )
          : null,

        props && props.close
          ? h(
              'div',
              { style: styles.actions },
              h('button', { type: 'button', style: styles.button, onClick: props.close }, t('workbench.close')),
            )
          : null,

        h('p', { style: styles.note }, t('note.m2')),
      )
    }

    /**
     * 对话页头部徽章：小圆点 + 短文案，只表达会话态与是否有任务在跑。
     */
    function StatusChip(props) {
      const t = translator(props)
      const host = useHostState()
      const state = host.state
      const session = (state && state.session) || null
      const sessionState = (session && session.state) || 'absent'
      const errorCode = (session && session.error && session.error.code) || ''
      const ended = sessionState === 'error' && errorCode === 'session_ended'
      const warming = sessionState === 'error' && errorCode === 'warming'
      const running = activeJobOf(state)
      const label = running
        ? jobStatusText(t, running.status)
        : ended
          ? t('workbench.sessionEnded')
          : sessionStateText(t, sessionState)
      const color = running ? jobColor(running.status) : ended || warming ? token.warn : sessionColor(sessionState)
      const title = [
        running ? jobStatusText(t, running.status) : '',
        ended ? t('workbench.restartSession') : '',
        warming ? t('error.code.warming') : '',
        sessionStateText(t, sessionState),
        session && session.detail ? session.detail : '',
        state && state.probe && state.probe.auth && state.probe.auth.ok === true ? t('chip.online') : t('chip.offline'),
      ]
        .filter(Boolean)
        .join(' · ')

      return h(
        'span',
        { style: styles.headerChip, title },
        h('span', { style: styles.dot(color) }),
        h('span', { style: styles.headerChipText }, label),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', DICT.zh), 'imagen:locale-zh')
        ctx.effect(() => ctx.locale.register(NS, 'en', DICT.en), 'imagen:locale-en')

        const label = () => {
          try {
            return ctx.locale.bind(NS)('nav.label')
          } catch {
            return DICT.zh['nav.label']
          }
        }

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'our-free-imagen',
              order: 40,
              label,
              locale: NS,
            },
            Workbench,
          ),
        )

        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'our-free-imagen-status',
              order: 30,
              label,
              locale: NS,
            },
            StatusChip,
          ),
        )
      },
    }
  },
})
