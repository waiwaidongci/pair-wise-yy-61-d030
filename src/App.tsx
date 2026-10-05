import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSelector } from 'react-redux';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Divider,
  Field,
  FluentProvider,
  Input,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Tab,
  TabList,
  Tag,
  Textarea,
  webLightTheme
} from '@fluentui/react-components';
import {
  AlertRegular,
  ArrowDownloadRegular,
  ArrowSyncRegular,
  BookOpenRegular,
  CheckmarkCircleRegular,
  ClipboardTaskListLtrRegular,
  CloudArrowUpRegular,
  CloudOffRegular,
  DocumentBulletListRegular,
  GaugeRegular,
  HistoryRegular,
  LockClosedRegular,
  NavigationRegular,
  PeopleRegular,
  ShieldRegular,
  WarningRegular
} from '@fluentui/react-icons';
import { setFailWrites, useGetWorkPackageQuery, useSubmitCardMutation } from './api';
import {
  authorizeOverride,
  refreshVersion,
  releasePackage,
  selectAuth,
  selectCard,
  setConflict,
  toggleOffline,
  toggleWriteFailures,
  updateCard,
  switchUser,
  confirmPending,
  dismissPending,
  handoverShift,
  resetDemo,
  useAppDispatch,
  STAGES,
  type RootState
} from './store';
import { effectiveRow, evaluateReleaseGates, isStageComplete, type SignRole, type StageId, type SignatureRow } from './auth/domain';
import {
  requestSignature,
  resignFlow,
  revokeQualFlow,
  transferFlow,
  deactivateActingFlow,
  type SignResult
} from './auth/flows';

type NavItem = { path: string; label: string; icon: ReactNode };

const statusBadge = (status: SignatureRow['status']) => {
  switch (status) {
    case '有效': return <Badge appearance="tint" color="success">已签署·有效</Badge>;
    case '待复核': return <Badge appearance="tint" color="warning">待复核</Badge>;
    case '待换签': return <Badge appearance="tint" color="danger">待换签</Badge>;
    default: return <Badge appearance="tint" color="danger">已失效·待签</Badge>;
  }
};

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const nav: NavItem[] = [
    { path: '/', label: '工作包总览', icon: <ClipboardTaskListLtrRegular /> },
    { path: '/execution', label: '工卡执行', icon: <BookOpenRegular /> },
    { path: '/release', label: '放行审阅', icon: <LockClosedRegular /> },
    { path: '/authorization', label: '授权管理', icon: <ShieldRegular /> },
    { path: '/audit', label: '审计与差异', icon: <HistoryRegular /> }
  ];
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon"><NavigationRegular /></div>
          <div><strong>航空定检执行台</strong><span>Maintenance Authorization Chain</span></div>
        </div>
        <div className="aircraft-chip"><span>B-7891</span><strong>B737-800</strong><Badge appearance="tint" color="brand">48A 定检</Badge></div>
        <div className="header-spacer" />
        <button className={`sync-status ${state.offline ? 'offline' : ''}`} onClick={() => dispatch(toggleOffline())}>
          {state.offline ? <CloudOffRegular /> : <CloudArrowUpRegular />}<span>{state.offline ? '离线暂存' : `已同步 R${state.syncVersion}`}</span>
        </button>
        <label className="user-chip user-switch">
          <span>当前班次 / 操作人</span>
          <strong>{state.currentShift} ·
            <select value={state.currentUserId} onChange={(e) => dispatch(switchUser(e.target.value))}>
              {state.personnel.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
            </select>
          </strong>
        </label>
      </header>
      <div className="shell-grid">
        <aside className="side-nav">
          <div className="package-summary">
            <span>工作包</span><strong>WP-B7891-04</strong><small>上海浦东 · H3 机库</small>
            <div><ProgressBar value={0.58} /><span>58% 工卡完成 · 授权版本 A{state.authVersion}</span></div>
          </div>
          <nav>{nav.map((item) => <NavLink end={item.path === '/'} key={item.path} to={item.path}>{item.icon}<span>{item.label}</span></NavLink>)}</nav>
          <div className="side-status"><WarningRegular /><div><strong>{state.cards.filter((card) => card.status === '待授权').length} 项待授权</strong><span>放行前必须处理</span></div></div>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{actions}</div></div>;
}

function SignatureDetail({ row }: { row: SignatureRow }) {
  return (
    <div className="sig-detail">
      <strong>{row.personName}{row.actingId ? <Tag appearance="brand">代班 {row.actingId}</Tag> : null}</strong>
      <small>{row.time} · {row.shift}</small>
      <small className={row.certNo ? 'cert-ok' : 'cert-missing'}>
        {row.certNo ? `资质 ${row.certNo}（有效期至 ${row.qualValidUntil}）${row.backfilled ? ' · 名册回填' : ''}` : '无资质号'}
      </small>
      {row.pendingReason && <small className="cert-missing">{row.pendingReason}</small>}
      {row.invalidReason && <small className="cert-missing">{row.invalidReason}</small>}
    </div>
  );
}

function Overview() {
  const state = useSelector((root: RootState) => root.maintenance);
  const { data } = useGetWorkPackageQuery();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const completed = state.cards.filter((card) => card.status === '已完成').length;
  const blockers = state.cards.filter((card) => card.status === '待授权');
  const openSigs = state.signatures.filter((item) => item.status !== '有效').length;
  return (
    <div className="page">
      <PageHeading eyebrow="WP-B7891-04 / 48A CHECK" title="工作包总览" description="工卡—阶段签字—人员资质—放行基线已接成授权链；交班、撤回、换岗实时联动。" actions={<><Button appearance="secondary" icon={<ArrowDownloadRegular />}>导出进度</Button><Button appearance="primary" icon={<NavigationRegular />} onClick={() => navigate('/execution')}>继续执行</Button></>} />
      {state.authMessage && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>授权变更：</strong>{state.authMessage}</MessageBarBody></MessageBar>}
      {blockers.length > 0 && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>放行阻断：</strong>{blockers.map((card) => `${card.id} ${card.title}`).join('、')} 等待授权人员处理。</MessageBarBody></MessageBar>}
      <div className="metrics-grid">
        {[
          ['工卡完成度', `${completed} / ${state.cards.length}`, `${Math.round(completed / state.cards.length * 100)}%`, 'green'],
          ['已记录工时', '18.6 h', '计划 20.5 h', 'blue'],
          ['开放发现', String(state.cards.filter((card) => card.finding && card.status !== '已完成').length), '1 项重复缺陷', 'amber'],
          ['非有效签字', String(openSigs), '失效/待复核/待换签合计', 'red']
        ].map((item) => <div className="metric-card" key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small className={item[3]}>{item[2]}</small></div>)}
      </div>
      <div className="overview-grid">
        <section className="panel task-panel">
          <div className="panel-head"><div><h2>关键工卡与依赖</h2><span>按执行依赖和风险排序</span></div><Badge appearance="tint">{data?.revision ?? 'WP R7'}</Badge></div>
          {state.cards.map((card, index) => (
            <button key={card.id} className={`task-row ${state.activeCardId === card.id ? 'active' : ''}`} onClick={() => { dispatch(selectCard(card.id)); navigate('/execution'); }}>
              <span className={`task-index ${card.status === '已完成' ? 'done' : card.status === '待授权' ? 'blocked' : ''}`}>{card.status === '已完成' ? <CheckmarkCircleRegular /> : index + 1}</span>
              <span className="task-main"><strong>{card.id} · {card.title}</strong><small>{card.zone} · 依赖 {card.dependencies.length ? card.dependencies.join('、') : '无'} · 施工 {state.personnel.find((p) => p.id === card.executorId)?.name ?? '未登记'}</small></span>
              <Tag appearance="outline" size="small">{card.stage}</Tag>
              <Badge appearance="tint" color={card.status === '已完成' ? 'success' : card.status === '待授权' ? 'danger' : card.status === '执行中' ? 'brand' : 'informative'}>{card.status}</Badge>
            </button>
          ))}
        </section>
        <aside className="overview-side">
          <section className="panel stage-panel">
            <div className="panel-head"><div><h2>阶段签字（授权链）</h2><span>资质有效期与代班关系随签字登记</span></div></div>
            {STAGES.map((meta) => {
              const rows = state.signatures.filter((r) => r.stage === meta.id);
              const latest = rows[rows.length - 1];
              return (
                <div className="signature-row" key={meta.id}>
                  <span className={isStageComplete(state.signatures, meta.id) ? 'signed' : ''}>{isStageComplete(state.signatures, meta.id) ? <CheckmarkCircleRegular /> : meta.id.slice(0, 1)}</span>
                  <div>
                    <strong>{meta.id}阶段签署 {meta.quality ? <Tag appearance="outline">质量·执行/复核分离</Tag> : null}</strong>
                    {latest ? <SignatureDetail row={latest} /> : <small>待签署</small>}
                    <div className="sig-badges">{rows.map((r) => <span key={r.id}>{statusBadge(r.status)}</span>)}</div>
                  </div>
                </div>
              );
            })}
          </section>
          <section className="panel dependency-panel"><div className="panel-head"><h2>依赖路径</h2><GaugeRegular /></div><div className="dependency-graph"><span>CARD-01</span><i /><span>CARD-02</span><i /><span className="critical">CARD-03</span><i /><span>CARD-07</span><i /><span>CARD-08</span></div></section>
        </aside>
      </div>
    </div>
  );
}

function Execution() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const { data } = useGetWorkPackageQuery();
  const card = state.cards.find((item) => item.id === state.activeCardId) ?? state.cards[0];
  const [measurement, setMeasurement] = useState(card.measurement);
  const [finding, setFinding] = useState(card.finding);
  const [consumable, setConsumable] = useState('');
  const [witness, setWitness] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [submitCard] = useSubmitCardMutation();
  useEffect(() => { setMeasurement(card.measurement); setFinding(card.finding); }, [card.id, card.measurement, card.finding]);
  const toleranceIssue = card.id === 'CARD-03' && Number.parseFloat(measurement) < 2850;
  const dependenciesMet = card.dependencies.every((dependency) => state.cards.find((item) => item.id === dependency)?.status === '已完成');
  const complete = async () => {
    if (!dependenciesMet) { dispatch(setConflict(`前置工卡 ${card.dependencies.join('、')} 尚未完成。`)); return; }
    if (toleranceIssue) { dispatch(setConflict('测量值超出容差，必须由授权人员处理。')); return; }
    if (!witness) { dispatch(setConflict('关键步骤必须完成见证确认。')); return; }
    if (state.syncVersion !== state.serverVersion) { dispatch(setConflict('检测到冲突提交：本地版本与服务器版本不一致，请刷新后重试。')); return; }
    const result = await submitCard({ cardId: card.id, expectedRevision: state.serverVersion, measurement, finding }).unwrap().catch((error) => {
      dispatch(setConflict(error.data?.message ?? '提交失败，请重试。'));
      return null;
    });
    if (result?.accepted) {
      // 工卡执行人随提交登记，作为质量阶段职责分离的比对基线
      dispatch(updateCard({ measurement, finding, status: '已完成', executorId: state.currentUserId }));
      dispatch(setConflict(''));
    }
  };
  return (
    <div className="page">
      <PageHeading eyebrow={`${card.id} / ${card.stage}`} title={card.title} description={`${card.zone} · 工卡版本 ${data?.revision ?? 'R7'} · 预计 ${card.estimated} 小时`} actions={<><Button appearance="secondary" icon={<ArrowSyncRegular />} onClick={() => dispatch(toggleOffline())}>{state.offline ? '恢复在线' : '离线暂存'}</Button><Button appearance="primary" icon={<CheckmarkCircleRegular />} onClick={complete}>完成并提交</Button></>} />
      {state.conflictMessage && <MessageBar intent="error" className="top-message"><MessageBarBody><strong>提交被阻断：</strong>{state.conflictMessage}</MessageBarBody><Button appearance="secondary" size="small" onClick={() => dispatch(refreshVersion())}>刷新版本</Button></MessageBar>}
      <div className="execution-grid">
        <section className="panel card-editor">
          <div className="panel-head"><div><h2>工卡执行内容</h2><span>执行人随提交登记，质量阶段复核将比对同一人</span></div><Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'brand'}>{card.status}</Badge></div>
          <div className="procedure-block">
            <h3>施工步骤</h3>
            {['确认飞机断电并设置 DO NOT OPERATE 警告牌。', '连接校准合格的测试设备，按 AMM 29-10-00 执行压力保持测试。', '记录稳定压力值，检查 10 分钟内压降。', '恢复系统构型，目视检查渗漏并上传证据。'].map((step, index) => <label key={step} className="procedure-step"><Checkbox defaultChecked={index < 2} /><span><b>{index + 1}.</b> {step}</span></label>)}
          </div>
          <Divider />
          <div className="form-grid">
            <Field label="测量值" hint={card.tolerance} validationState={toleranceIssue ? 'error' : 'none'} validationMessage={toleranceIssue ? '低于最低接受值 2850 psi' : undefined}><Input value={measurement} onChange={(_, d) => setMeasurement(d.value)} contentBefore={<GaugeRegular />} /></Field>
            <Field label="耗材 / 航材"><Input value={consumable} onChange={(_, d) => setConsumable(d.value)} placeholder="输入件号或耗材批次" /></Field>
            <Field label="发现与处置" className="wide-field"><Textarea value={finding} onChange={(_, d) => setFinding(d.value)} resize="vertical" placeholder="正常或填写缺陷、处置措施" /></Field>
            <Field label="证据附件" className="wide-field"><div className="upload-zone"><CloudArrowUpRegular /><strong>拖入照片、测试记录或报告</strong><span>已关联 3 个证据 · 支持 JPG / PDF / TXT</span></div></Field>
          </div>
          <label className="witness-check"><Checkbox checked={witness} onChange={(_, d) => setWitness(Boolean(d.checked))} /><span><strong>见证人已现场确认</strong><small>要求：{card.witness}</small></span></label>
        </section>
        <aside className="execution-side">
          <section className="panel card-meta"><div className="panel-head"><h2>工卡信息</h2><DocumentBulletListRegular /></div><dl><div><dt>容差</dt><dd>{card.tolerance}</dd></div><div><dt>证据要求</dt><dd>{card.evidence}</dd></div><div><dt>前置条件</dt><dd>{card.dependencies.length ? card.dependencies.join('、') : '无'}</dd></div><div><dt>阶段签署</dt><dd>{card.stage}</dd></div><div><dt>登记施工人</dt><dd>{state.personnel.find((p) => p.id === card.executorId)?.name ?? '未登记'}</dd></div></dl></section>
          {card.status === '待授权' && <section className="panel override-panel"><WarningRegular /><h3>超差项目等待授权</h3><p>原始测量值已保留。授权人员可以批准工程指令、退回复测或要求停场处理。</p><Button appearance="primary" onClick={() => setOverrideOpen(true)}>授权处理</Button></section>}
        </aside>
      </div>
      <Dialog open={overrideOpen} onOpenChange={(_, d) => setOverrideOpen(d.open)}><DialogSurface><DialogBody><DialogTitle>超差授权处理</DialogTitle><DialogContent>批准后将在工卡中记录授权人、工程指令编号与处置依据，原始测量值不会被覆盖。<Field label="工程指令编号" required className="dialog-field"><Input defaultValue="EO-2026-1147" /></Field><Field label="授权依据" required className="dialog-field"><Textarea defaultValue="按 AMM 容差分析并经工程部门确认，允许执行复测与系统恢复。" /></Field></DialogContent><DialogActions><Button appearance="secondary" onClick={() => setOverrideOpen(false)}>取消</Button><Button appearance="primary" onClick={() => { dispatch(authorizeOverride()); setOverrideOpen(false); }}>确认授权</Button></DialogActions></DialogBody></DialogSurface></Dialog>
    </div>
  );
}

function SignButton({ stage, role, label }: { stage: StageId; role: SignRole; label?: string }) {
  const dispatch = useAppDispatch();
  const auth = useSelector((root: RootState) => selectAuth(root, stage, role));
  const [busy, setBusy] = useState(false);
  const click = async () => { setBusy(true); try { await dispatch(requestSignature(stage, role)); } finally { setBusy(false); } };
  return (
    <TooltipGate ok={auth.ok} reason={auth.reason}>
      <Button size="small" appearance="primary" disabled={!auth.ok || busy} onClick={click}>{label ?? (role === '执行' ? '签署' : '复核签署')}</Button>
    </TooltipGate>
  );
}

function TooltipGate({ ok, reason, children }: { ok: boolean; reason: string; children: ReactNode }) {
  if (ok) return <>{children}</>;
  return <span title={`授权链拦截：${reason}`}>{children}</span>;
}

function Release() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState('signatures');
  const gates = evaluateReleaseGates(state.signatures, state.cards);
  const blockers = state.cards.filter((card) => card.status !== '已完成' && card.status !== '未开始');
  const allPass = gates.every((g) => g.pass);
  return (
    <div className="page">
      <PageHeading eyebrow="RELEASE REVIEW / B-7891" title="放行审阅" description="签字须沿授权链有效；放行时固化只读快照，之后授权变化不影响基线。" actions={<Button appearance="primary" icon={<LockClosedRegular />} disabled={!allPass || state.released} onClick={() => dispatch(releasePackage())}>{state.released ? '工作包已锁定' : '锁定并放行'}</Button>} />
      {state.released && <MessageBar intent="success" className="top-message"><MessageBarBody>工作包已于 {state.baseline?.time} 锁定（R{state.baseline?.revision}），{state.baseline?.snapshot.length} 个签字形成只读放行基线；后续授权变更不会回改快照。</MessageBarBody></MessageBar>}
      {state.conflictMessage && <MessageBar intent="error" className="top-message"><MessageBarBody>{state.conflictMessage}</MessageBarBody></MessageBar>}
      <div className="release-grid">
        <section className="panel release-main">
          <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(String(d.value))}>
            <Tab value="signatures">签字链 <Badge>{state.signatures.filter((r) => r.status !== '有效').length}</Badge></Tab>
            <Tab value="open">未关闭项目 <Badge>{blockers.length}</Badge></Tab>
            <Tab value="snapshot">放行基线 {state.released ? <Badge appearance="tint" color="success">已固化</Badge> : null}</Tab>
          </TabList>
          <div className="tab-body">
            {tab === 'signatures' && STAGES.map((meta) => (
              <div className="chain-block" key={meta.id}>
                <div className="chain-head"><strong>{meta.id}阶段</strong>{meta.quality ? <Tag appearance="outline">质量阶段：同一人不得既执行又复核</Tag> : <Tag>单签</Tag>}{isStageComplete(state.signatures, meta.id) ? <Badge appearance="tint" color="success">阶段完成</Badge> : <Badge appearance="tint" color="warning">待签</Badge>}</div>
                {meta.requiredRoles.map((role) => {
                  const roleRows = state.signatures.filter((r) => r.stage === meta.id && r.role === role).sort((a, b) => a.seq - b.seq);
                  const eff = effectiveRow(state.signatures, meta.id, role);
                  return (
                    <div className="chain-role" key={role}>
                      <span className="chain-role-name">{role}</span>
                      <div className="chain-rows">
                        {roleRows.length === 0 && <small className="chain-empty">未提交</small>}
                        {roleRows.map((row) => (
                          <div className={`chain-row chain-${row.status}`} key={row.id}>
                            <SignatureDetail row={row} />
                            <div className="chain-actions">
                              {statusBadge(row.status)}
                              {row.status === '待复核' && <><Button size="small" appearance="primary" onClick={() => dispatch(confirmPending(row.id))}>复核确认生效</Button><Button size="small" appearance="subtle" onClick={() => dispatch(dismissPending({ rowId: row.id, note: '先到签字有效，后到提交不予采纳' }))}>驳回回待签</Button></>}
                              {row.status === '待换签' && <Button size="small" appearance="primary" onClick={() => dispatch(resignFlow(row.id))}>按当前登录人换签</Button>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {!eff && !state.released && <SignButton stage={meta.id} role={role} />}
                    </div>
                  );
                })}
              </div>
            ))}
            {tab === 'signatures' && state.drafts.length > 0 && (
              <div className="draft-list">
                <strong>写入失败保留的签字草稿（恢复后按原事件号重试，不会多签）</strong>
                {state.drafts.map((d) => {
                  const person = state.personnel.find((p) => p.id === d.personId);
                  return (
                    <div className="draft-row" key={d.eventId}>
                      <span>{d.eventId} · {d.stage}·{d.role} · {person?.name} · 已尝试 {d.attempts} 次</span>
                      <Button size="small" appearance="primary" onClick={() => dispatch(requestSignature(d.stage, d.role, d.personId))}>重试提交</Button>
                    </div>
                  );
                })}
              </div>
            )}
            {tab === 'open' && blockers.map((card) => <div className="review-item" key={card.id}><span className={`risk-icon ${card.status === '待授权' ? 'danger' : ''}`}><AlertRegular /></span><div><strong>{card.id} · {card.title}</strong><p>{card.finding || '工卡正在执行，完成后需由放行人员复核。'}</p><small>{card.zone} · 施工 {state.personnel.find((p) => p.id === card.executorId)?.name ?? '未登记'} · 要求证据 {card.evidence}</small></div><Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'warning'}>{card.status}</Badge></div>)}
            {tab === 'snapshot' && (
              state.released ? (
                <div className="snapshot-list">
                  <MessageBar intent="success" className="top-message"><MessageBarBody>快照时间 {state.baseline?.time} · R{state.baseline?.revision}，共 {state.baseline?.snapshot.length} 个签字，只读保留。</MessageBarBody></MessageBar>
                  {state.baseline?.snapshot.map((row) => <div className="chain-row" key={row.id}><SignatureDetail row={row} /><Badge appearance="tint" color="success">基线签字</Badge></div>)}
                </div>
              ) : <p className="chain-empty">尚未放行；放行后此处展示固化的签字快照，不受后续资质撤回/换岗影响。</p>
            )}
          </div>
        </section>
        <aside className="release-side">
          <section className="panel release-gate-card">
            <LockClosedRegular /><h3>放行门禁（授权链）</h3>
            {gates.map((g) => <label key={g.label}><Checkbox checked={g.pass} readOnly /><span><b>{g.label}</b><small>{g.detail}</small></span></label>)}
            <Divider />
            <Button size="small" appearance="subtle" icon={<CloudOffRegular />} onClick={() => { const next = !state.writeFailures; dispatch(toggleWriteFailures()); setFailWrites(next); }}>{state.writeFailures ? '模拟写入中断中：点击恢复' : '模拟写入失败（验证草稿与事件号保留）'}</Button>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Authorization() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const [stage, setStage] = useState<StageId>('系统');
  const [role, setRole] = useState<SignRole>('执行');
  const [busy, setBusy] = useState(false);
  const [raceMsg, setRaceMsg] = useState('');
  const qualOf = (personId: string, scope: StageId) => state.personnel.find((p) => p.id === personId)?.qualifications.find((q) => q.scope === scope);
  const runRace = async () => {
    setBusy(true);
    setRaceMsg('两名检验员同时提交系统·执行签字，服务端按接收顺序仲裁……');
    const [a, b] = await Promise.all([
      dispatch(requestSignature('系统', '执行', 'P03')),
      dispatch(requestSignature('系统', '执行', 'P04'))
    ]);
    const label = (r: SignResult) =>
      ({ accepted: '先到→生效', duplicate: '幂等重放→不多签', pending: '后到→待复核', 'write-failed': '写入失败→草稿保留', rejected: '授权链拦截' }[r.outcome]);
    setRaceMsg(`结果：P03 ${label(a)}；P04 ${label(b)}。先到者生效，后到者保留待复核。`);
    setBusy(false);
  };
  return (
    <div className="page">
      <PageHeading eyebrow="AUTHORIZATION CHAIN" title="授权管理" description="班次名册、人员资质、代班关系与阶段签字联动；授权范围一变化，未放行签字立即失效回待签。" actions={<><Button appearance="secondary" onClick={() => dispatch(handoverShift(state.currentShift === '早班' ? '中班' : '早班'))}>模拟交班（↔ {state.currentShift === '早班' ? '中班' : '早班'}）</Button><Button appearance="subtle" onClick={() => { dispatch(resetDemo()); location.reload(); }}>重置演示数据</Button></>} />
      {state.conflictMessage && <MessageBar intent="error" className="top-message"><MessageBarBody>{state.conflictMessage}</MessageBarBody></MessageBar>}
      <div className="auth-grid">
        <section className="panel">
          <div className="panel-head"><div><h2>人员与资质</h2><span>撤回资质立即使未放行相关签字失效</span></div><span>当前班次：{state.currentShift}</span></div>
          {state.personnel.map((p) => (
            <div className="person-row" key={p.id}>
              <div className="person-head"><strong>{p.name}</strong><span>{p.role} · {p.shift}{p.id === state.currentUserId ? <Tag appearance="brand">当前登录</Tag> : null}</span></div>
              <div className="qual-list">
                {p.qualifications.map((q) => (
                  <div className="qual-row" key={q.certNo}>
                    <span><b>{q.scope}</b> {q.certNo} <small>{q.validFrom} ~ {q.validUntil}</small></span>
                    {q.active
                      ? <Badge appearance="tint" color="success">有效</Badge>
                      : <Badge appearance="tint" color="danger">已撤回</Badge>}
                    {q.active && <Button size="small" appearance="subtle" onClick={() => dispatch(revokeQualFlow(p.id, q.scope))}>撤回</Button>}
                  </div>
                ))}
                {p.qualifications.length === 0 && <small>无资质记录</small>}
              </div>
              <div className="person-actions">
                <Button size="small" appearance="subtle" onClick={() => dispatch(transferFlow(p.id, p.shift === '中班' ? '夜班' : '中班'))}>换岗至 {p.shift === '中班' ? '夜班' : '中班'}</Button>
              </div>
            </div>
          ))}
        </section>
        <aside className="auth-side">
          <section className="panel">
            <div className="panel-head"><h2>班次名册</h2><PeopleRegular /></div>
            {state.shifts.map((s) => (
              <div className="shift-block" key={s.name}>
                <strong>{s.name}{s.name === state.currentShift ? <Tag appearance="brand">当班</Tag> : null}</strong>
                {s.roster.map((r) => <small key={`${r.personId}-${r.scope}`}>{state.personnel.find((p) => p.id === r.personId)?.name} · {r.scope}</small>)}
              </div>
            ))}
          </section>
          <section className="panel">
            <div className="panel-head"><h2>代班关系</h2><ShieldRegular /></div>
            {state.relations.map((r) => {
              const sub = state.personnel.find((p) => p.id === r.substituteId);
              const q = qualOf(r.substituteId, r.scope);
              return (
                <div className="acting-row" key={r.id}>
                  <div><strong>{r.id}</strong><small>{sub?.name} 代 {r.shift} · {r.scope}（{r.validFrom}~{r.validUntil}）</small><small className={q?.active ? 'cert-ok' : 'cert-missing'}>资质校验：{q?.active ? `${q.certNo} 有效` : '无有效资质，签字将被拦'}</small></div>
                  {r.active ? <><Badge appearance="tint" color="success">生效中</Badge><Button size="small" appearance="subtle" onClick={() => dispatch(deactivateActingFlow(r.id))}>停用</Button></> : <Badge appearance="tint" color="danger">已停用</Badge>}
                </div>
              );
            })}
          </section>
          <section className="panel chain-tester">
            <div className="panel-head"><h2>授权链试签 / 并发场景</h2></div>
            <div className="tester-controls">
              <Field label="阶段"><select value={stage} onChange={(e) => setStage(e.target.value as StageId)}>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.id}{s.quality ? '（质量·双签）' : ''}</option>)}</select></Field>
              <Field label="角色"><select value={role} onChange={(e) => setRole(e.target.value as SignRole)}><option value="执行">执行</option><option value="复核">复核</option></select></Field>
              <Button appearance="primary" disabled={busy} onClick={async () => { setBusy(true); try { await dispatch(requestSignature(stage, role)); } finally { setBusy(false); } }}>以当前登录人提交签字</Button>
              <Button appearance="subtle" disabled={busy} onClick={runRace}>并发：P03 与 P04 同签系统·执行</Button>
              {raceMsg && <small>{raceMsg}</small>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Audit() {
  const state = useSelector((root: RootState) => root.maintenance);
  const downloadAudit = () => {
    const csv = ['时间,操作者,动作,说明', ...state.audit.map((item) => [item.time, item.actor, item.action, item.detail].join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'B7891-48A-audit.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const diffs = useMemo(() => [
    { card: 'CARD-03', field: '容差', from: '≥ 2800 psi / 10 min', to: '≥ 2850 psi / 10 min', reason: 'AMM 临时修订 TR-114' },
    { card: 'CARD-07', field: '依赖', from: 'CARD-02', to: 'CARD-03', reason: '试车前置条件调整' },
    { card: 'CARD-08', field: '证据', from: '近 2 次记录', to: '近 3 次记录', reason: '可靠性复核要求' }
  ], []);
  return (
    <div className="page">
      <PageHeading eyebrow="AUDIT / VERSION CONTROL" title="审计与版本差异" description="授权链事件、签字登记要素、旧签字回填与放行快照均可追溯。" actions={<Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={downloadAudit}>导出审计记录</Button>} />
      <div className="audit-grid">
        <section className="panel diff-panel"><div className="panel-head"><div><h2>工卡版本差异</h2><span>R6 → R7 · 3 处变更</span></div><select defaultValue="R7"><option>R7</option><option>R6</option><option>R5</option></select></div><div className="diff-table"><div className="diff-head"><span>工卡</span><span>字段</span><span>原值</span><span>新值 / 原因</span></div>{diffs.map((diff) => <div className="diff-row" key={`${diff.card}-${diff.field}`}><strong>{diff.card}</strong><span>{diff.field}</span><del>{diff.from}</del><div><ins>{diff.to}</ins><small>{diff.reason}</small></div></div>)}</div></section>
        <section className="panel audit-panel"><div className="panel-head"><div><h2>完整审计时间线</h2><span>{state.audit.length} 条记录 · 授权版本 A{state.authVersion}</span></div><HistoryRegular /></div>{state.audit.map((item, index) => <div className="audit-row" key={`${item.time}-${index}`}><span className="timeline-dot" /><div><strong>{item.action}</strong><p>{item.detail}</p><small>{item.time} · {item.actor}</small></div></div>)}</section>
      </div>
    </div>
  );
}

function NotFound() {
  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <BrowserRouter>
        <Shell><Routes><Route path="/" element={<Overview />} /><Route path="/execution" element={<Execution />} /><Route path="/release" element={<Release />} /><Route path="/authorization" element={<Authorization />} /><Route path="/audit" element={<Audit />} /><Route path="*" element={<NotFound />} /></Routes></Shell>
      </BrowserRouter>
    </FluentProvider>
  );
}
