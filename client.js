window.__ModuleLoader__.load({
  id: 'dsh-our-free-imagen',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'our-free-imagen'
    const DICT = {
      zh: {
        'nav.label': '免费生图工作台',
        'page.title': '免费生图工作台',
        'page.subtitle': '借 Kaggle 免费 GPU 运行开源文生图模型。当前为 M1：环境探测与资源状态；出图在 M2 开放。',
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
        'chip.offline': '生图未就绪',
        'chip.online': '生图就绪',
        'note.m2': '生成工作台与队列在 M2 交付；当前页面数据全部来自实测目录 docs/MODEL-CATALOG.md。',
      },
      en: {
        'nav.label': 'Free imagen',
        'page.title': 'Free imagen workbench',
        'page.subtitle': 'Run open image models on free Kaggle GPUs. M1 ships environment probing and resource status; generation arrives in M2.',
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
        'chip.offline': 'Imagen not ready',
        'chip.online': 'Imagen ready',
        'note.m2': 'The generation workbench and queue ship in M2; every number here comes from the measured catalogue in docs/MODEL-CATALOG.md.',
      },
    }

    function fallbackTranslate(lang) {
      const dict = lang && lang.toLowerCase().startsWith('zh') ? DICT.zh : DICT.en
      return (key) => dict[key] ?? DICT.en[key] ?? key
    }

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

    const styles = {
      page: { display: 'grid', gap: 18, padding: '4px 0 24px', color: token.text },
      title: { margin: 0, fontSize: 18, fontWeight: 600 },
      subtitle: { margin: '6px 0 0', fontSize: 13, color: token.textSub, lineHeight: 1.6 },
      row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      grid4: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 },
      cell: {
        border: `1px solid ${token.border}`,
        borderRadius: 10,
        padding: '10px 12px',
        background: token.bg,
        display: 'grid',
        gap: 4,
      },
      cellLabel: { fontSize: 11, color: token.textSub, letterSpacing: 0.2 },
      cellValue: { fontSize: 14, fontWeight: 600 },
      section: { display: 'grid', gap: 10 },
      sectionTitle: { fontSize: 13, fontWeight: 600, color: token.textSub },
      step: {
        display: 'grid',
        gridTemplateColumns: '18px 1fr',
        gap: 8,
        alignItems: 'start',
        padding: '8px 10px',
        border: `1px solid ${token.border}`,
        borderRadius: 10,
        background: token.bg,
      },
      dot: (color) => ({ width: 8, height: 8, borderRadius: 99, background: color, marginTop: 6 }),
      stepTitle: { fontSize: 13, fontWeight: 600 },
      stepHint: { fontSize: 12, color: token.textSub, lineHeight: 1.5, marginTop: 2 },
      cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 },
      card: {
        border: `1px solid ${token.border}`,
        borderRadius: 10,
        background: token.bg,
        padding: '12px 14px',
        display: 'grid',
        gap: 6,
      },
      cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
      cardName: { fontSize: 13, fontWeight: 600 },
      badge: (color, text) => ({
        fontSize: 11,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: '1px 7px',
        whiteSpace: 'nowrap',
      }),
      kv: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 12, color: token.textSub },
      button: {
        appearance: 'none',
        border: `1px solid ${token.border}`,
        background: token.bgAlt,
        color: token.text,
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 12,
        cursor: 'pointer',
      },
      note: { fontSize: 12, color: token.textSub, lineHeight: 1.6 },
      chip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: token.textSub,
        padding: '2px 8px',
        border: `1px solid ${token.border}`,
        borderRadius: 999,
        background: token.bg,
      },
    }

    function useWorkbenchState(intervalMs) {
      const [state, setState] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const url = new URL('imagen-api/state', document.baseURI)
            const res = await fetch(url, { headers: { accept: 'application/json' } })
            if (!res.ok) return
            const value = await res.json()
            if (alive) setState(value)
          } catch {
            /* host route unavailable before activation; retry on the next tick */
          }
        }
        load()
        const id = setInterval(load, intervalMs)
        return () => {
          alive = false
          clearInterval(id)
        }
      }, [intervalMs])
      return [state, setState]
    }

    function statusOf(probe) {
      if (!probe) return { color: token.idle, key: 'value.unknown' }
      if (probe.auth?.ok) return { color: token.ok, key: 'value.ok' }
      return { color: token.error, key: 'value.failed' }
    }

    function Workbench(props) {
      const t = props.t ?? fallbackTranslate(typeof document === 'undefined' ? 'en' : document.documentElement.lang)
      const [state, setState] = useWorkbenchState(10000)
      const [busy, setBusy] = React.useState(false)

      const probe = state?.probe ?? null
      const account = statusOf(probe)
      const quota = probe?.quota?.available
        ? `${probe.quota.usedHours} / ${probe.quota.totalHours ?? '?'} h`
          + (probe.quota.remainingHours != null ? ` · 剩 ${probe.quota.remainingHours}` : '')
        : probe
          ? t('value.quotaUnavailable')
          : t('value.unknown')
      const sessionLabel = state?.session?.state === 'absent' || !state?.session
        ? t('value.sessionAbsent')
        : state.session.state
      const presets = state?.presets ?? []
      const defaultPreset = state?.defaultPreset ?? ''

      const runProbe = async () => {
        setBusy(true)
        try {
          const res = await fetch(new URL('imagen-api/probe', document.baseURI), { method: 'POST' })
          if (res.ok) {
            const value = await res.json()
            setState((prev) => ({ ...(prev ?? {}), probe: value.probe, probeAt: Date.now() }))
          }
        } catch {
          /* leave the previous state in place */
        } finally {
          setBusy(false)
        }
      }

      const guide = [
        ['guide.step1', 'guide.hint1', probe?.cli?.present === true, probe ? (probe.cli?.present ? token.ok : token.error) : token.idle],
        ['guide.step2', 'guide.hint2', probe?.auth?.ok === true, probe ? (probe.auth?.ok ? token.ok : token.error) : token.idle],
        ['guide.step3', 'guide.hint3', null, token.idle],
        ['guide.step4', 'guide.hint4', null, token.idle],
      ]

      return h('div', { style: styles.page },
        h('div', { style: styles.section },
          h('h2', { style: styles.title }, t('page.title')),
          h('p', { style: styles.subtitle }, t('page.subtitle')),
        ),
        h('div', { style: styles.row },
          h('button', { type: 'button', style: styles.button, onClick: runProbe, disabled: busy },
            busy ? t('action.probing') : t('action.probe')),
          probe?.cli?.version ? h('span', { style: styles.note }, `kaggle ${probe.cli.version}`) : null,
        ),
        h('div', { style: styles.grid4 },
          h('div', { style: styles.cell },
            h('div', { style: styles.cellLabel }, t('status.account')),
            h('div', { style: { ...styles.cellValue, color: account.color } }, t(account.key)),
          ),
          h('div', { style: styles.cell },
            h('div', { style: styles.cellLabel }, t('status.quota')),
            h('div', { style: styles.cellValue }, quota),
          ),
          h('div', { style: styles.cell },
            h('div', { style: styles.cellLabel }, t('status.session')),
            h('div', { style: styles.cellValue }, sessionLabel),
          ),
          h('div', { style: styles.cell },
            h('div', { style: styles.cellLabel }, t('status.defaultModel')),
            h('div', { style: styles.cellValue }, defaultPreset || t('value.unknown')),
          ),
        ),
        h('div', { style: styles.section },
          h('div', { style: styles.sectionTitle }, t('guide.title')),
          ...guide.map(([titleKey, hintKey, done, color]) =>
            h('div', { key: titleKey, style: styles.step },
              h('span', { style: styles.dot(done === true ? token.ok : done === false ? token.error : color) }),
              h('div', null,
                h('div', { style: styles.stepTitle }, t(titleKey)),
                h('div', { style: styles.stepHint }, t(hintKey)),
              ),
            ),
          ),
        ),
        h('div', { style: styles.section },
          h('div', { style: styles.sectionTitle }, t('models.title')),
          h('div', { style: styles.cardGrid },
            ...presets.map((preset) =>
              h('div', { key: preset.id, style: styles.card },
                h('div', { style: styles.cardHead },
                  h('span', { style: styles.cardName }, preset.id),
                  h('span', {
                    style: styles.badge(
                      preset.licenseKind === 'open' ? token.ok : token.warn,
                      preset.licenseKind === 'open' ? preset.license : t('models.license.restricted'),
                    ),
                  }, preset.licenseKind === 'open' ? preset.license : t('models.license.restricted')),
                ),
                h('div', { style: styles.kv },
                  h('span', null, t('models.params')), h('span', null, preset.params),
                  h('span', null, t('models.download')), h('span', null, `${preset.downloadGb} GB`),
                  h('span', null, t('models.gpus')), h('span', null, `${preset.gpus} ${t('unit.card')}`),
                  h('span', null, t('models.steady')),
                  h('span', null, preset.steadySeconds == null
                    ? t('models.pending')
                    : `${preset.steadySeconds}${t('unit.second')} · ${preset.size}²`),
                ),
                h('div', { style: styles.note }, `${preset.label} · ${t(`models.tier.${preset.tier}`)}`),
              ),
            ),
          ),
        ),
        h('p', { style: styles.note }, t('note.m2')),
        props.close ? h('div', { style: styles.row },
          h('button', { type: 'button', style: styles.button, onClick: props.close }, '关闭'),
        ) : null,
      )
    }

    function StatusChip(props) {
      const t = props.t ?? fallbackTranslate(typeof document === 'undefined' ? 'en' : document.documentElement.lang)
      const [state] = useWorkbenchState(20000)
      const ready = state?.probe?.auth?.ok === true
      return h('span', { style: styles.chip, title: ready ? t('chip.online') : t('chip.offline') },
        h('span', {
          style: {
            width: 7,
            height: 7,
            borderRadius: 99,
            background: ready ? token.ok : token.idle,
            display: 'inline-block',
          },
        }),
        h('span', null, '生图'),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', DICT.zh), 'imagen:locale-zh')
        ctx.effect(() => ctx.locale.register(NS, 'en', DICT.en), 'imagen:locale-en')

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'our-free-imagen',
              order: 40,
              label: () => ctx.locale.bind(NS)('nav.label'),
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
              label: () => ctx.locale.bind(NS)('nav.label'),
              locale: NS,
            },
            StatusChip,
          ),
        )
      },
    }
  },
})
