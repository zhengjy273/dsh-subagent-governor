// Browser half of @local/dsh-subagent-governor.
// Registers a "子智能体管理" section in Settings that edits this plugin's Host Config
// through the Client configForms service (namespace = the plugin's patch id).
window.__ModuleLoader__.load({
  id: '@local/dsh-subagent-governor',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS_UI = 'subagent-governor.ui'
    const CONFIG_NS = 'subagent-governor'

    const zh = {
      title: '子智能体管理',
      description: '控制本会话子智能体的总量上限与复用行为。保存后立即生效，无需重启。',
      unavailable: '该插件的配置当前不可用（插件未加载或未提供设置命名空间）。',
      readOnly: '本部署的设置为只读。',
      save: '保存',
      saving: '保存中…',
      discard: '放弃更改',
      saved: '已保存',
      saveFailed: '保存失败',
      back: '返回设置',
      unsaved: '有未保存的更改',
      groupLimits: '总量与达限',
      groupReuse: '复用检查',
      groupAdvanced: '高级',
      maxTotal: '总量上限',
      maxTotalHelp: '存活中 + 已运行结束的子智能体总数；0 表示禁止新建（只可复用已有子智能体）。',
      limitBehavior: '达上限行为',
      limitAsk: '询问后允许',
      limitDeny: '直接拒绝',
      quotaEnabled: '启用总量上限',
      quotaEnabledHelp: '关闭后只保留复用检查。',
      syncActiveCap: '联动内置活跃上限',
      syncActiveCapHelp: '总量上限低于内置活跃上限（默认 8）时，自动把内置活跃上限下调为同值；只降不升。',
      reuseCheck: '复用检查强度',
      reuseEnforce: '自动复用（enforce）',
      reuseEnforceAsk: '先问是否复用（enforce-ask）',
      reuseAdvise: '仅提示（advise）',
      reuseOff: '关闭复用检查（off）',
      reuseCheckHelp: '高相似时：enforce 直接把任务转发给旧子智能体（不新建）；enforce-ask 先问你是否复用，同意则自动转发；advise 只提示；off 不检查。',
      strongThreshold: '强制复用阈值',
      strongThresholdHelp: '0–1；达到该分数即判定为“高相似”。',
      candidateThreshold: '候选阈值',
      candidateThresholdHelp: '0–1；低于该分数不会进入候选清单。',
      candidateLimit: '候选条数上限',
      candidateLimitHelp: '1–20。',
      checkTtlMs: '检查记录有效期（毫秒）',
      checkTtlMsHelp: '同一任务重复派发时，此窗口内沿用上次判定。',
      queryTimeoutMs: '目录查询超时（毫秒）',
      queryTimeoutMsHelp: '超时则放行本次派发（宁可不拦，不卡死）。',
      guardTools: '拦截的工具名',
      guardToolsHelp: '逗号分隔，例如 subagent, subagent_fork。',
      injectHint: '注入使用提示',
      injectHintHelp: '向系统提示注入治理说明。',
      invalidNumber: '请输入有效数字',
      outOfRange: '数值超出允许范围',
    }

    const en = {
      title: 'Subagent manager',
      description: 'Control this session\'s subagent total cap and reuse behavior. Changes apply immediately.',
      unavailable: 'This plugin\'s settings are unavailable (plugin not loaded or no settings namespace).',
      readOnly: 'This deployment stores settings read-only.',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      saved: 'Saved',
      saveFailed: 'Save failed',
      back: 'Back to settings',
      unsaved: 'Unsaved changes',
      groupLimits: 'Total cap and limit behavior',
      groupReuse: 'Reuse check',
      groupAdvanced: 'Advanced',
      maxTotal: 'Total cap',
      maxTotalHelp: 'Living + finished subagents; 0 blocks new subagents (reuse only).',
      limitBehavior: 'When the cap is reached',
      limitAsk: 'Ask before allowing',
      limitDeny: 'Reject immediately',
      quotaEnabled: 'Enforce the total cap',
      quotaEnabledHelp: 'Turn off to keep only the reuse check.',
      syncActiveCap: 'Sync the built-in active cap',
      syncActiveCapHelp: 'When the total cap is below the built-in active cap (default 8), lower that cap to match. Never raises it.',
      reuseCheck: 'Reuse check strength',
      reuseEnforce: 'Auto-reuse (enforce)',
      reuseEnforceAsk: 'Ask before reusing (enforce-ask)',
      reuseAdvise: 'Advise only (advise)',
      reuseOff: 'Off (off)',
      reuseCheckHelp: 'On high similarity: enforce forwards the task to the existing child automatically; enforce-ask asks first; advise only hints; off skips the check.',
      strongThreshold: 'Strong-reuse threshold',
      strongThresholdHelp: '0–1; a score at or above this counts as high similarity.',
      candidateThreshold: 'Candidate threshold',
      candidateThresholdHelp: '0–1; lower scores never enter the candidate list.',
      candidateLimit: 'Candidate limit',
      candidateLimitHelp: '1–20.',
      checkTtlMs: 'Check record TTL (ms)',
      checkTtlMsHelp: 'Within this window a repeated task keeps its last verdict.',
      queryTimeoutMs: 'Catalog query timeout (ms)',
      queryTimeoutMsHelp: 'Timing out lets the dispatch through (fail open).',
      guardTools: 'Guarded tools',
      guardToolsHelp: 'Comma separated, e.g. subagent, subagent_fork.',
      injectHint: 'Inject usage hint',
      injectHintHelp: 'Add governance guidance to the system prompt.',
      invalidNumber: 'Enter a valid number',
      outOfRange: 'Value is out of range',
    }

    const FIELDS = [
      { key: 'maxTotal', kind: 'number', min: 0, max: 999, step: 1 },
      { key: 'limitBehavior', kind: 'select', options: [['ask', 'limitAsk'], ['deny', 'limitDeny']] },
      { key: 'quotaEnabled', kind: 'toggle' },
      { key: 'syncActiveCap', kind: 'toggle' },
      { key: 'reuseCheck', kind: 'select', options: [['enforce', 'reuseEnforce'], ['enforce-ask', 'reuseEnforceAsk'], ['advise', 'reuseAdvise'], ['off', 'reuseOff']] },
      { key: 'strongThreshold', kind: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'candidateThreshold', kind: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'candidateLimit', kind: 'number', min: 1, max: 20, step: 1 },
      { key: 'checkTtlMs', kind: 'number', min: 0, step: 1000 },
      { key: 'queryTimeoutMs', kind: 'number', min: 100, step: 100 },
      { key: 'guardTools', kind: 'text' },
      { key: 'injectHint', kind: 'toggle' },
    ]

    const GROUPS = [
      ['groupLimits', ['maxTotal', 'limitBehavior', 'quotaEnabled', 'syncActiveCap']],
      ['groupReuse', ['reuseCheck', 'strongThreshold', 'candidateThreshold', 'candidateLimit']],
      ['groupAdvanced', ['injectHint', 'checkTtlMs', 'queryTimeoutMs', 'guardTools']],
    ]

    const FIELD_HELP = {
      maxTotal: 'maxTotalHelp',
      limitBehavior: 'limitBehaviorHelp',
      quotaEnabled: 'quotaEnabledHelp',
      syncActiveCap: 'syncActiveCapHelp',
      reuseCheck: 'reuseCheckHelp',
      strongThreshold: 'strongThresholdHelp',
      candidateThreshold: 'candidateThresholdHelp',
      candidateLimit: 'candidateLimitHelp',
      checkTtlMs: 'checkTtlMsHelp',
      queryTimeoutMs: 'queryTimeoutMsHelp',
      guardTools: 'guardToolsHelp',
      injectHint: 'injectHintHelp',
    }

    function snapshotOf(scope) {
      try {
        const snapshot = scope && typeof scope.getSnapshot === 'function' ? scope.getSnapshot() : null
        if (snapshot && typeof snapshot === 'object') return snapshot
      } catch {}
      return { status: 'unavailable', writable: false, revision: 0, value: {} }
    }

    const PALETTE = {
      text: 'var(--dsw-alias-label-primary)',
      sub: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l1)',
      card: 'var(--dsw-alias-bg-layer-1)',
      accent: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
    }

    function GovernorSection(props) {
      const t = props.t
      const getScope = props.getScope
      const [scope, setScope] = React.useState(function () { return getScope ? getScope() : undefined })
      const [snapshot, setSnapshot] = React.useState(() => snapshotOf(scope))
      const [draft, setDraft] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [error, setError] = React.useState('')
      const [flash, setFlash] = React.useState('')

      React.useEffect(function () {
        if (scope) return undefined
        const timer = setInterval(function () {
          const next = getScope ? getScope() : undefined
          if (next) setScope(next)
        }, 300)
        return function () { clearInterval(timer) }
      }, [scope, getScope])

      React.useEffect(function () {
        if (!scope || typeof scope.subscribe !== 'function') return undefined
        setSnapshot(snapshotOf(scope))
        const off = scope.subscribe(function () { setSnapshot(snapshotOf(scope)) })
        return function () { if (typeof off === 'function') off() }
      }, [scope])

      const base = snapshot.value && typeof snapshot.value === 'object' ? snapshot.value : {}
      const values = draft === null ? base : draft
      const ready = snapshot.status === 'ready'
      const writable = ready && snapshot.writable !== false
      const dirty = draft !== null

      function setField(key, value) {
        setDraft(Object.assign({}, draft === null ? base : draft, { [key]: value }))
        setError('')
        setFlash('')
      }

      function collectOps() {
        const ops = []
        for (let i = 0; i < FIELDS.length; i += 1) {
          const field = FIELDS[i]
          const raw = values[field.key]
          if (field.kind === 'number') {
            const text = String(raw == null ? '' : raw).trim()
            if (text === '') return { error: t('invalidNumber') }
            const numeric = Number(text)
            if (!Number.isFinite(numeric)) return { error: t('invalidNumber') }
            if (field.min !== undefined && numeric < field.min) return { error: t('outOfRange') }
            if (field.max !== undefined && numeric > field.max) return { error: t('outOfRange') }
            if (!Object.is(numeric, base[field.key])) ops.push({ op: 'set', path: [field.key], value: numeric })
          } else if (field.kind === 'text') {
            const text = String(raw == null ? '' : raw).trim()
            const next = text === '' ? [] : text.split(',').map((item) => item.trim()).filter(Boolean)
            const previous = Array.isArray(base[field.key]) ? base[field.key] : []
            if (next.join(',') !== previous.join(',')) ops.push({ op: 'set', path: [field.key], value: next })
          } else if (!Object.is(raw, base[field.key])) {
            ops.push({ op: 'set', path: [field.key], value: raw })
          }
        }
        return { ops: ops }
      }

      function save() {
        if (!writable || saving) return
        const collected = collectOps()
        if (collected.error) { setError(collected.error); return }
        if (collected.ops.length === 0) { setFlash(t('saved')); setDraft(null); return }
        setSaving(true)
        setError('')
        setFlash('')
        Promise.resolve(scope.mutate(collected.ops, snapshot.revision)).then(
          function () {
            setSaving(false)
            setDraft(null)
            setSnapshot(snapshotOf(scope))
            setFlash(t('saved'))
          },
          function (failure) {
            setSaving(false)
            setError((failure && failure.message) || t('saveFailed'))
          },
        )
      }

      function control(field) {
        const id = 'sg-' + field.key
        const disabled = !writable || saving
        const raw = values[field.key]
        if (field.kind === 'number') {
          return h('input', {
            id: id,
            type: 'number',
            value: raw === undefined || raw === null ? '' : String(raw),
            min: field.min,
            max: field.max,
            step: field.step || 1,
            disabled: disabled,
            onChange: function (event) { setField(field.key, event.target.value === '' ? '' : Number(event.target.value)) },
            style: inputStyle,
          })
        }
        if (field.kind === 'select') {
          return h('select', {
            id: id,
            value: raw === undefined || raw === null ? '' : raw,
            disabled: disabled,
            onChange: function (event) { setField(field.key, event.target.value) },
            style: selectStyle,
          }, field.options.map(function (option) {
            return h('option', { key: option[0], value: option[0] }, t(option[1]))
          }))
        }
        if (field.kind === 'toggle') {
          const on = raw === true
          return h('button', {
            id: id,
            type: 'button',
            role: 'switch',
            'aria-checked': on,
            disabled: disabled,
            onClick: function () { setField(field.key, !on) },
            style: toggleStyle(on),
          }, h('span', { style: knobStyle(on) }))
        }
        const text = Array.isArray(raw) ? raw.join(', ') : raw === undefined || raw === null ? '' : String(raw)
        return h('input', {
          id: id,
          type: 'text',
          value: text,
          disabled: disabled,
          onChange: function (event) { setField(field.key, event.target.value) },
          style: inputStyle,
        })
      }

      function row(field) {
        const helpKey = FIELD_HELP[field.key]
        return h('div', { key: field.key, style: rowStyle },
          h('div', { style: { flex: '1 1 auto', minWidth: 0, paddingRight: '16px' } },
            h('label', { htmlFor: 'sg-' + field.key, style: labelStyle }, t(field.key)),
            helpKey ? h('div', { style: helpStyle }, t(helpKey)) : null,
          ),
          h('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center' } }, control(field)),
        )
      }

      function group(titleKey, keys) {
        const fields = FIELDS.filter(function (field) { return keys.indexOf(field.key) >= 0 })
        return h('section', { key: titleKey, style: cardStyle },
          h('h3', { style: groupTitleStyle }, t(titleKey)),
          fields.map(row),
        )
      }

      const children = [
        h('header', { key: 'header', style: headerStyle },
          h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            h('h2', { style: titleStyle }, t('title')),
            h('p', { style: descriptionStyle }, t('description')),
          ),
          typeof props.close === 'function'
            ? h('button', { key: 'back', type: 'button', onClick: function () { props.close() }, style: backStyle }, t('back'))
            : null,
        ),
      ]

      if (!ready) children.push(h('div', { key: 'unavailable', style: noticeStyle }, t('unavailable')))
      else if (!writable) children.push(h('div', { key: 'readonly', style: noticeStyle }, t('readOnly')))

      children.push(h('div', { key: 'groups' }, GROUPS.map(function (entry) { return group(entry[0], entry[1]) })))

      children.push(h('footer', { key: 'footer', style: footerStyle },
        h('span', { style: statusStyle },
          error ? h('span', { style: { color: PALETTE.error } }, error)
            : flash ? h('span', { style: { color: PALETTE.success } }, flash)
              : dirty ? h('span', { style: { color: PALETTE.sub } }, t('unsaved'))
                : null,
        ),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('button', {
            type: 'button',
            disabled: !dirty || saving,
            onClick: function () { setDraft(null); setError(''); setFlash('') },
            style: secondaryButtonStyle,
          }, t('discard')),
          h('button', {
            type: 'button',
            disabled: !writable || saving || !dirty,
            onClick: save,
            style: primaryButtonStyle,
          }, saving ? t('saving') : t('save')),
        ),
      ))

      return h('div', { style: rootStyle }, children)
    }

    const rootStyle = {
      padding: '8px 0 40px',
      color: PALETTE.text,
      fontSize: '14px',
      lineHeight: '1.5',
      maxWidth: '880px',
    }
    const headerStyle = { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }
    const titleStyle = { margin: '0 0 4px', fontSize: '20px', fontWeight: 600, color: PALETTE.text }
    const descriptionStyle = { margin: 0, color: PALETTE.sub, fontSize: '13px' }
    const cardStyle = {
      border: '1px solid ' + PALETTE.border,
      borderRadius: '12px',
      background: PALETTE.card,
      padding: '16px 18px',
      marginBottom: '14px',
    }
    const groupTitleStyle = { margin: '0 0 12px', fontSize: '14px', fontWeight: 600, color: PALETTE.text }
    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '10px 0',
      borderTop: '1px solid ' + PALETTE.border,
    }
    const labelStyle = { fontSize: '13px', fontWeight: 500, color: PALETTE.text }
    const helpStyle = { fontSize: '12px', color: PALETTE.sub, marginTop: '2px' }
    const inputStyle = {
      width: '180px',
      padding: '6px 10px',
      borderRadius: '8px',
      border: '1px solid ' + PALETTE.border,
      background: 'var(--dsw-alias-bg-base)',
      color: PALETTE.text,
      fontSize: '13px',
      boxSizing: 'border-box',
    }
    const selectStyle = Object.assign({}, inputStyle, { width: '220px' })
    function toggleStyle(on) {
      return {
        position: 'relative',
        width: '40px',
        height: '22px',
        padding: 0,
        borderRadius: '11px',
        border: '1px solid ' + (on ? PALETTE.accent : PALETTE.border),
        background: on ? PALETTE.accent : 'transparent',
        cursor: 'pointer',
        transition: 'background 120ms ease',
      }
    }
    function knobStyle(on) {
      return {
        position: 'absolute',
        top: '2px',
        left: on ? '20px' : '2px',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        background: 'var(--dsw-alias-bg-layer-1)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        transition: 'left 120ms ease',
      }
    }
    const footerStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      marginTop: '8px',
    }
    const statusStyle = { fontSize: '12px', minHeight: '16px' }
    const primaryButtonStyle = {
      padding: '7px 16px',
      borderRadius: '8px',
      border: '1px solid ' + PALETTE.accent,
      background: PALETTE.accent,
      color: '#fff',
      fontSize: '13px',
      fontWeight: 500,
      cursor: 'pointer',
    }
    const secondaryButtonStyle = {
      padding: '7px 14px',
      borderRadius: '8px',
      border: '1px solid ' + PALETTE.border,
      background: 'transparent',
      color: PALETTE.text,
      fontSize: '13px',
      cursor: 'pointer',
    }
    const backStyle = Object.assign({}, secondaryButtonStyle, { flex: '0 0 auto' })
    const noticeStyle = {
      padding: '10px 12px',
      borderRadius: '10px',
      border: '1px solid ' + PALETTE.border,
      color: PALETTE.sub,
      background: 'var(--dsw-alias-bg-layer-2)',
      marginBottom: '14px',
      fontSize: '13px',
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS_UI)
      ctx.effect(function () {
        return ctx.locale.register(NS_UI, { zh: zh, en: en })
      }, 'subagent-governor: dictionaries')

      function resolveNamespace(forms) {
        try {
          const mirror = typeof forms.describe === 'function' ? forms.describe() : undefined
          const snapshot = mirror && typeof mirror.getSnapshot === 'function' ? mirror.getSnapshot() : undefined
          const view = snapshot && snapshot.view
          const rows = view && Array.isArray(view.namespaces) ? view.namespaces : []
          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i]
            if (row && row.ns === CONFIG_NS) return row.ns
          }
          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i]
            if (row && typeof row.ns === 'string' && row.ns.endsWith(CONFIG_NS)) return row.ns
          }
        } catch (e) {
          return undefined
        }
        return undefined
      }

      function getScope() {
        try {
          const forms = ctx.get('configForms')
          if (!forms || typeof forms.get !== 'function') return undefined
          const ns = resolveNamespace(forms)
          if (ns === undefined) {
            const mirror = typeof forms.describe === 'function' ? forms.describe() : undefined
            if (mirror && typeof mirror.ensure === 'function') mirror.ensure()
            return undefined
          }
          return forms.get(ns)
        } catch (e) {
          return undefined
        }
      }

      ctx.effect(function () {
        return ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'subagent-governor',
            order: 55,
            label: function () { return t('title') },
            locale: NS_UI,
          }, function (props) {
            return h(GovernorSection, Object.assign({}, props, { t: t, getScope: getScope }))
          })
        })
      }, 'subagent-governor: settings section')
    }

    return { inject: ['slots', 'locale'], apply: apply }
  },
})
