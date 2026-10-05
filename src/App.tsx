import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
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
  Radio,
  Tab,
  TabList,
  Tag,
  Text,
  Textarea,
  Tooltip,
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
  WarningRegular
} from '@fluentui/react-icons';
import { useGetWorkPackageQuery, useSignStageMutation, useSubmitCardMutation } from './api';
import {
  AUTH_TODAY,
  REVIEW_STAGES,
  STAGE_CARD,
  authorizeOverride,
  backfillSignatures,
  findActingFor,
  findQualForStage,
  handoffShift,
  refreshVersion,
  releasePackage,
  resolveReviewCandidate,
  retryPendingWrite,
  revokeQualification,
  selectCard,
  setConflict,
  signStage,
  transferPerson,
  toggleOffline,
  updateCard,
  validateSign,
  type PendingWrite,
  type RootState
} from './store';

type NavItem = { path: string; label: string; icon: ReactNode };

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const nav: NavItem[] = [
    { path: '/', label: '工作包总览', icon: <ClipboardTaskListLtrRegular /> },
    { path: '/execution', label: '工卡执行', icon: <BookOpenRegular /> },
    { path: '/release', label: '放行审阅', icon: <LockClosedRegular /> },
    { path: '/audit', label: '审计与差异', icon: <HistoryRegular /> }
  ];
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon"><NavigationRegular /></div>
          <div><strong>航空定检执行台</strong><span>Maintenance Work Package</span></div>
        </div>
        <div className="aircraft-chip"><span>B-7891</span><strong>B737-800</strong><Badge appearance="tint" color="brand">48A 定检</Badge></div>
        <div className="header-spacer" />
        <button className={`sync-status ${state.offline ? 'offline' : ''}`} onClick={() => dispatch(toggleOffline())}>
          {state.offline ? <CloudOffRegular /> : <CloudArrowUpRegular />}<span>{state.offline ? '离线暂存' : `已同步 R${state.syncVersion}`}</span>
        </button>
        <div className="user-chip"><span>执行人员</span><strong>宋杰 · 机械</strong></div>
      </header>
      <div className="shell-grid">
        <aside className="side-nav">
          <div className="package-summary">
            <span>工作包</span><strong>WP-B7891-04</strong><small>上海浦东 · H3 机库 · {state.shift}班</small>
            <div><ProgressBar value={0.58} /><span>58% 工卡完成</span></div>
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

function signatureBadge(status: string) {
  if (status === '已签署') return <Badge appearance="tint" color="success">已签署</Badge>;
  if (status === '待复核') return <Badge appearance="tint" color="warning">待复核</Badge>;
  if (status === '已失效') return <Badge appearance="tint" color="danger">已失效</Badge>;
  return <Badge appearance="tint">待签署</Badge>;
}

function Overview() {
  const state = useSelector((root: RootState) => root.maintenance);
  const { data } = useGetWorkPackageQuery();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const completed = state.cards.filter((card) => card.status === '已完成').length;
  const blockers = state.cards.filter((card) => card.status === '待授权');
  const activeSignatures = state.signatures.filter((item) => item.status !== '已失效');
  return (
    <div className="page">
      <PageHeading eyebrow="WP-B7891-04 / 48A CHECK" title="工作包总览" description="监控工卡依赖、阶段签字、超差项目和放行门禁；工卡、资质、签字、基线已接成授权链。" actions={<><Button appearance="secondary" icon={<ArrowDownloadRegular />}>导出进度</Button><Button appearance="primary" icon={<NavigationRegular />} onClick={() => navigate('/execution')}>继续执行</Button></>} />
      {blockers.length > 0 && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>放行阻断：</strong>{blockers.map((card) => `${card.id} ${card.title}`).join('、')} 等待授权人员处理。</MessageBarBody></MessageBar>}
      <div className="metrics-grid">
        {[
          ['工卡完成度', `${completed} / ${state.cards.length}`, `${Math.round(completed / state.cards.length * 100)}%`, 'green'],
          ['已记录工时', '18.6 h', '计划 20.5 h', 'blue'],
          ['开放发现', String(state.cards.filter((card) => card.finding && card.status !== '已完成').length), '1 项重复缺陷', 'amber'],
          ['待签署阶段', String(activeSignatures.filter((item) => item.status === '待签署').length), '放行前完成', 'red']
        ].map((item) => <div className="metric-card" key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small className={item[3]}>{item[2]}</small></div>)}
      </div>
      <div className="overview-grid">
        <section className="panel task-panel">
          <div className="panel-head"><div><h2>关键工卡与依赖</h2><span>按执行依赖和风险排序</span></div><Badge appearance="tint">{data?.revision ?? 'WP R7'}</Badge></div>
          {state.cards.map((card, index) => (
            <button key={card.id} className={`task-row ${state.activeCardId === card.id ? 'active' : ''}`} onClick={() => { dispatch(selectCard(card.id)); navigate('/execution'); }}>
              <span className={`task-index ${card.status === '已完成' ? 'done' : card.status === '待授权' ? 'blocked' : ''}`}>{card.status === '已完成' ? <CheckmarkCircleRegular /> : index + 1}</span>
              <span className="task-main"><strong>{card.id} · {card.title}</strong><small>{card.zone} · 依赖 {card.dependencies.length ? card.dependencies.join('、') : '无'} · 计划 {card.estimated}h · 执行人 {card.executorName}</small></span>
              <Tag appearance="outline" size="small">{card.stage}</Tag>
              <Badge appearance="tint" color={card.status === '已完成' ? 'success' : card.status === '待授权' ? 'danger' : card.status === '执行中' ? 'brand' : 'informative'}>{card.status}</Badge>
            </button>
          ))}
        </section>
        <aside className="overview-side">
          <section className="panel stage-panel">
            <div className="panel-head"><div><h2>阶段签字</h2><span>资质号随签字登记</span></div><PeopleRegular /></div>
            {activeSignatures.map((item) => (
              <div className="signature-row" key={item.id}>
                <span className={item.status === '已签署' ? 'signed' : ''}>{item.status === '已签署' ? <CheckmarkCircleRegular /> : item.status === '待复核' ? <PeopleRegular /> : item.stage.slice(0, 1)}</span>
                <div>
                  <strong>{item.stage}签署 {signatureBadge(item.status)}</strong>
                  <small>{item.status === '已签署' ? `${item.actor} · 资质 ${item.certNo || '无'} · ${item.time}` : item.status === '待复核' ? `${item.actor} 先到生效，${item.reviewCandidate?.actor} 待复核` : item.invalidReason || '待指定有资质人员'}</small>
                </div>
              </div>
            ))}
          </section>
          <section className="panel dependency-panel"><div className="panel-head"><h2>依赖路径</h2><GaugeRegular /></div><div className="dependency-graph"><span>CARD-01</span><i /><span>CARD-02</span><i /><span className="critical">CARD-03</span><i /><span>CARD-07</span><i /><span>CARD-08</span></div></section>
        </aside>
      </div>
    </div>
  );
}

function Execution() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const { data } = useGetWorkPackageQuery();
  const card = state.cards.find((item) => item.id === state.activeCardId) ?? state.cards[0];
  const currentUser = state.personnel.find((p) => p.id === state.currentUserId);
  const [measurement, setMeasurement] = useState(card.measurement);
  const [finding, setFinding] = useState(card.finding);
  const [consumable, setConsumable] = useState('');
  const [witness, setWitness] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [submitCard] = useSubmitCardMutation();
  useEffect(() => { setMeasurement(card.measurement); setFinding(card.finding); }, [card.id, card.measurement, card.finding]);
  const toleranceIssue = card.id === 'CARD-03' && Number.parseFloat(measurement) < 2850;
  const dependenciesMet = card.dependencies.every((dependency) => state.cards.find((item) => item.id === dependency)?.status === '已完成');
  const stageKey = card.stage.replace('签署', '');
  const signature = state.signatures.find((item) => item.stage === stageKey && item.status !== '已失效');
  const complete = async () => {
    if (!dependenciesMet) {
      dispatch(setConflict(`前置工卡 ${card.dependencies.join('、')} 尚未完成。`));
      return;
    }
    if (toleranceIssue) {
      dispatch(setConflict('测量值超出容差，必须由授权人员处理。'));
      return;
    }
    if (!witness) {
      dispatch(setConflict('关键步骤必须完成见证确认。'));
      return;
    }
    if (state.syncVersion !== state.serverVersion) {
      dispatch(setConflict('检测到冲突提交：本地版本与服务器版本不一致，请刷新后重试。'));
      return;
    }
    const result = await submitCard({ cardId: card.id, expectedRevision: state.serverVersion, measurement, finding }).unwrap().catch((error) => {
      dispatch(setConflict(error.data?.message ?? '提交失败，请重试。'));
      return null;
    });
    if (result?.accepted) {
      dispatch(updateCard({ measurement, finding, status: '已完成', executorId: state.currentUserId, executorName: currentUser?.name ?? card.executorName }));
      dispatch(setConflict(''));
    }
  };
  return (
    <div className="page">
      <PageHeading eyebrow={`${card.id} / ${card.stage}`} title={card.title} description={`${card.zone} · 工卡版本 ${data?.revision ?? 'R7'} · 预计 ${card.estimated} 小时`} actions={<><Button appearance="secondary" icon={<ArrowSyncRegular />} onClick={() => dispatch(toggleOffline())}>{state.offline ? '恢复在线' : '离线暂存'}</Button><Button appearance="primary" icon={<CheckmarkCircleRegular />} onClick={complete}>完成并提交</Button></>} />
      {state.conflictMessage && <MessageBar intent="error" className="top-message"><MessageBarBody><strong>提交被阻断：</strong>{state.conflictMessage}</MessageBarBody><Button appearance="secondary" size="small" onClick={() => dispatch(refreshVersion())}>刷新版本</Button></MessageBar>}
      <div className="execution-grid">
        <section className="panel card-editor">
          <div className="panel-head"><div><h2>工卡执行内容</h2><span>执行人员必须记录关键数据及证据</span></div><Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'brand'}>{card.status}</Badge></div>
          <div className="procedure-block">
            <h3>施工步骤</h3>
            {['确认飞机断电并设置 DO NOT OPERATE 警告牌。', '连接校准合格的测试设备，按 AMM 29-10-00 执行压力保持测试。', '记录稳定压力值，检查 10 分钟内压降。', '恢复系统构型，目视检查渗漏并上传证据。'].map((step, index) => <label key={step} className="procedure-step"><Checkbox defaultChecked={index < 2} /><span><b>{index + 1}.</b> {step}</span></label>)}
          </div>
          <Divider />
          <div className="form-grid">
            <Field label="测量值" hint={card.tolerance} validationState={toleranceIssue ? 'error' : 'none'} validationMessage={toleranceIssue ? '低于最低接受值 2850 psi' : undefined}><Input value={measurement} onChange={(_, data) => setMeasurement(data.value)} contentBefore={<GaugeRegular />} /></Field>
            <Field label="耗材 / 航材"><Input value={consumable} onChange={(_, data) => setConsumable(data.value)} placeholder="输入件号或耗材批次" /></Field>
            <Field label="发现与处置" className="wide-field"><Textarea value={finding} onChange={(_, data) => setFinding(data.value)} resize="vertical" placeholder="正常或填写缺陷、处置措施" /></Field>
            <Field label="证据附件" className="wide-field"><div className="upload-zone"><CloudArrowUpRegular /><strong>拖入照片、测试记录或报告</strong><span>已关联 3 个证据 · 支持 JPG / PDF / TXT</span></div></Field>
          </div>
          <label className="witness-check"><Checkbox checked={witness} onChange={(_, data) => setWitness(Boolean(data.checked))} /><span><strong>见证人已现场确认</strong><small>要求：{card.witness}</small></span></label>
        </section>
        <aside className="execution-side">
          <section className="panel card-meta">
            <div className="panel-head"><h2>工卡信息</h2><DocumentBulletListRegular /></div>
            <dl>
              <div><dt>容差</dt><dd>{card.tolerance}</dd></div>
              <div><dt>证据要求</dt><dd>{card.evidence}</dd></div>
              <div><dt>前置条件</dt><dd>{card.dependencies.length ? card.dependencies.join('、') : '无'}</dd></div>
              <div><dt>阶段签署</dt><dd>{signature ? (signature.status === '已签署' ? `${signature.actor} · ${signature.certNo || '无资质号'}` : signature.status === '待复核' ? '待复核' : '待签署') : '—'}</dd></div>
              <div><dt>执行人</dt><dd>{card.executorName}</dd></div>
            </dl>
          </section>
          {card.status === '待授权' && <section className="panel override-panel"><WarningRegular /><h3>超差项目等待授权</h3><p>原始测量值已保留。授权人员可以批准工程指令、退回复测或要求停场处理。</p><Button appearance="primary" onClick={() => setOverrideOpen(true)}>授权处理</Button></section>}
          <section className="panel evidence-panel"><div className="panel-head"><h2>证据附件</h2><Badge appearance="tint">3 项</Badge></div>{['IMG_20260929_0904.jpg', '液压测试原始记录.pdf', '见证签字单_宋杰.pdf'].map((file, index) => <div className="evidence-row" key={file}><DocumentBulletListRegular /><div><strong>{file}</strong><small>{index + 1}.8 MB · 09:1{index}</small></div><Button size="small" appearance="subtle">预览</Button></div>)}</section>
        </aside>
      </div>
      <Dialog open={overrideOpen} onOpenChange={(_, data) => setOverrideOpen(data.open)}><DialogSurface><DialogBody><DialogTitle>超差授权处理</DialogTitle><DialogContent>批准后将在工卡中记录授权人、工程指令编号与处置依据，原始测量值不会被覆盖。<Field label="工程指令编号" required className="dialog-field"><Input defaultValue="EO-2026-1147" /></Field><Field label="授权依据" required className="dialog-field"><Textarea defaultValue="按 AMM 容差分析并经工程部门确认，允许执行复测与系统恢复。" /></Field></DialogContent><DialogActions><Button appearance="secondary" onClick={() => setOverrideOpen(false)}>取消</Button><Button appearance="primary" onClick={() => { dispatch(authorizeOverride()); setOverrideOpen(false); }}>确认授权</Button></DialogActions></DialogBody></DialogSurface></Dialog>
    </div>
  );
}

function SignDialog({ open, onClose, stage, cardId }: { open: boolean; onClose: () => void; stage: string; cardId: string }) {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const [actorId, setActorId] = useState(state.currentUserId);
  const [forceFail, setForceFail] = useState(false);
  const [signStageMutation] = useSignStageMutation();
  const eventId = useMemo(() => `EVT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, [open]);
  useEffect(() => {
    if (open) {
      setActorId(state.currentUserId);
      setForceFail(false);
    }
  }, [open, state.currentUserId]);
  const card = state.cards.find((item) => item.id === cardId);
  const candidates = state.personnel.filter((p) => findQualForStage(p, stage) || findActingFor(p, stage));
  const validation = validateSign(state, stage, cardId, actorId);
  const handleConfirm = async () => {
    const result = await signStageMutation({ stage, cardId, actorId, eventId, forceFail }).unwrap().catch(() => {
      // 写入失败：保留原签字草稿与事件号，恢复后重试不能多签
      dispatch(signStage({ stage, cardId, actorId, eventId, forceFail: true }));
      return null;
    });
    if (result?.accepted) dispatch(signStage({ stage, cardId, actorId, eventId }));
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>阶段签署 · {stage} · {cardId}</DialogTitle>
          <DialogContent>
            <MessageBar intent="info" className="dialog-field"><MessageBarBody>签字将登记人员、资质有效期与代班关系；{REVIEW_STAGES.includes(stage) ? '本阶段为质量复核阶段，复核人与执行人不得为同一人；' : ''}资质撤回、换岗或交班后签字立即失效。</MessageBarBody></MessageBar>
            <div className="candidate-list">
              {candidates.length === 0 && <MessageBar intent="warning"><MessageBarBody>当前无在班且资质覆盖 {stage} 阶段的人员。</MessageBarBody></MessageBar>}
              {candidates.map((person) => {
                const qual = findQualForStage(person, stage);
                const acting = findActingFor(person, stage);
                return (
                  <div key={person.id} className={`candidate-option ${actorId === person.id ? 'selected' : ''}`} onClick={() => setActorId(person.id)}>
                    <Radio checked={actorId === person.id} />
                    <div className="candidate-main"><strong>{person.name}</strong><small>{person.role} · {person.shift}班</small></div>
                    <div className="candidate-qual">
                      {qual ? <><span>资质 {qual.id}</span><small>{qual.type} · 有效期至 {qual.validTo}</small></> : <><span>代班授权</span><small>代 {acting?.personName} · 至 {acting?.validTo}</small></>}
                    </div>
                  </div>
                );
              })}
            </div>
            {!validation.ok && <MessageBar intent="error" className="dialog-field"><MessageBarBody>{validation.reason}</MessageBarBody></MessageBar>}
            <label className="force-fail-check"><Checkbox checked={forceFail} onChange={(_, data) => setForceFail(Boolean(data.checked))} /><span><strong>模拟写入失败</strong><small>验证草稿与事件号保留，恢复后重试不能多签</small></span></label>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>取消</Button>
            <Button appearance="primary" disabled={!validation.ok} onClick={handleConfirm}>确认签署</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function ChainPanel() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  return (
    <section className="panel chain-panel">
      <div className="panel-head"><div><h2>授权链</h2><span>工卡 → 资质 → 签字 → 放行基线</span></div><Badge appearance="tint">{state.shift}班</Badge></div>
      <div className="chain-rows">
        {Object.entries(STAGE_CARD).map(([stage, cardId]) => {
          const row = state.signatures.find((s) => s.stage === stage && s.status !== '已失效');
          const person = state.personnel.find((p) => p.id === row?.actorId);
          const qual = person?.qualifications.find((q) => q.id === row?.certNo);
          return (
            <div className="chain-row" key={stage}>
              <span className="chain-card">{cardId}<small>{stage}阶段</small></span>
              <span className="chain-arrow">→</span>
              <span className={qual ? 'chain-qual ok' : 'chain-qual miss'}>{row?.certNo ? `${row.certNo} · ${qual?.validTo ?? '-'}` : '无资质'}</span>
              <span className="chain-arrow">→</span>
              <span className={row?.status === '已签署' ? 'chain-sign ok' : 'chain-sign miss'}>{row?.status === '已签署' ? `${row.actor} · ${row.time}` : row?.status === '待复核' ? '待复核' : '待签署'}</span>
              <span className="chain-arrow">→</span>
              <span className={state.baseline ? 'chain-base ok' : 'chain-base'}>{state.baseline ? `已基线 R${state.baseline.revision}` : '未放行'}</span>
            </div>
          );
        })}
      </div>
      <div className="chain-actions">
        <Button size="small" onClick={() => dispatch(handoffShift())}>交班（{state.shift} → {state.shift === '白班' ? '夜班' : '白班'}）</Button>
        <Button size="small" onClick={() => dispatch(backfillSignatures())}>回填旧签字资质号</Button>
      </div>
      <Divider />
      <div className="personnel-list">
        {state.personnel.map((person) => (
          <div className="person-row" key={person.id}>
            <div className="person-head">
              <strong>{person.name}</strong><small>{person.role} · {person.shift}班</small>
              {person.actingFor && <Badge appearance="tint" color="informative">代班 {person.actingFor.personName}（{person.actingFor.scope.join('/')}）</Badge>}
            </div>
            <div className="qual-list">
              {person.qualifications.map((qual) => (
                <div className={`qual-chip ${qual.status}`} key={qual.id}>
                  <span>{qual.id}</span><small>{qual.type} · {qual.scope.join('/')} · {qual.validTo}</small>
                  {qual.status === '有效'
                    ? <Button size="small" appearance="subtle" onClick={() => dispatch(revokeQualification({ personId: person.id, qualId: qual.id, reason: '资质复核中撤回' }))}>撤回</Button>
                    : <Badge size="small" appearance="tint" color={qual.status === '撤回' ? 'danger' : 'warning'}>{qual.status}</Badge>}
                </div>
              ))}
            </div>
            <Button size="small" appearance="subtle" onClick={() => dispatch(transferPerson({ personId: person.id, toRole: person.role.includes('已换岗') ? person.role : `${person.role}（已换岗）`, toShift: person.shift === '白班' ? '夜班' : '白班' }))}>换岗（调{person.shift === '白班' ? '夜' : '白'}班）</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function BaselineCard() {
  const state = useSelector((root: RootState) => root.maintenance);
  if (!state.baseline) return null;
  return (
    <section className="panel baseline-card">
      <div className="panel-head"><div><h2>放行基线快照</h2><span>已锁定 · 授权变更不再影响</span></div><LockClosedRegular /></div>
      <dl>
        <div><dt>基线版本</dt><dd>R{state.baseline.revision}</dd></div>
        <div><dt>放行时间</dt><dd>{state.baseline.releasedAt}</dd></div>
        <div><dt>放行人</dt><dd>{state.baseline.releasedBy}</dd></div>
        <div><dt>随档封存</dt><dd>工卡 {state.baseline.cards.length} · 签字 {state.baseline.signatures.length} · 人员资质 {state.baseline.personnel.length}</dd></div>
      </dl>
    </section>
  );
}

function Release() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const [tab, setTab] = useState('open');
  const [dialogStage, setDialogStage] = useState<string | null>(null);
  const [signStageMutation] = useSignStageMutation();
  const blockers = state.cards.filter((card) => card.status !== '已完成' && card.status !== '未开始');
  const activeRows = state.signatures.filter((row) => row.status !== '已失效');
  const invalidatedRows = state.signatures.filter((row) => row.status === '已失效');
  const allSigned = activeRows.length === Object.keys(STAGE_CARD).length && activeRows.every((item) => item.status === '已签署');
  const chainOk = activeRows.every((s) => {
    if (s.status !== '已签署' || !s.certNo) return false;
    const person = state.personnel.find((p) => p.id === s.actorId);
    const qual = person?.qualifications.find((q) => q.id === s.certNo);
    return Boolean(qual && qual.status === '有效' && qual.validTo >= AUTH_TODAY);
  });
  const segregationOk = activeRows.every((s) => {
    if (s.status !== '已签署') return true;
    const card = state.cards.find((c) => c.id === s.cardId);
    return !(REVIEW_STAGES.includes(s.stage) && card && s.actorId && card.executorId === s.actorId);
  });
  const hasLegacy = activeRows.some((s) => s.status === '已签署' && !s.certNo);
  const releaseDisabled = state.released || blockers.some((card) => card.status === '待授权') || !allSigned || !chainOk || !segregationOk;
  const retryWrite = async (pending: PendingWrite) => {
    const result = await signStageMutation({ stage: pending.stage, cardId: pending.cardId, actorId: pending.draft.actorId, eventId: pending.eventId }).unwrap().catch(() => null);
    if (result?.accepted) dispatch(retryPendingWrite(pending.eventId));
  };
  return (
    <div className="page">
      <PageHeading eyebrow="RELEASE REVIEW / B-7891" title="放行审阅" description="核对未关闭项目、重复缺陷、关键证据与阶段签字；授权链完整方可锁定放行。" actions={<Button appearance="primary" icon={<LockClosedRegular />} disabled={releaseDisabled} onClick={() => dispatch(releasePackage())}>{state.released ? '工作包已锁定' : '锁定并放行'}</Button>} />
      {state.released && <MessageBar intent="success" className="top-message"><MessageBarBody>工作包已锁定，形成只读放行基线快照；此后资质撤回、换岗、交班均不影响基线。</MessageBarBody></MessageBar>}
      {hasLegacy && !state.released && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>历史签字缺少资质号：</strong>旧签字未登记资质号，放行门禁不通过。请按班次名册回填，回填不通过将留待换签。</MessageBarBody><Button appearance="secondary" size="small" onClick={() => dispatch(backfillSignatures())}>回填资质号</Button></MessageBar>}
      {state.pendingWrites.map((pending) => (
        <MessageBar intent="error" className="top-message" key={pending.eventId}>
          <MessageBarBody><strong>签字写入失败，草稿已保留：</strong>{pending.stage}阶段 · {pending.draft.actor} · 资质 {pending.draft.certNo} · 事件号 {pending.eventId} · 已重试 {pending.attempts} 次。{pending.lastError}</MessageBarBody>
          <Button appearance="secondary" size="small" onClick={() => retryWrite(pending)}>重试写入</Button>
        </MessageBar>
      ))}
      {state.conflictMessage && <MessageBar intent="error" className="top-message"><MessageBarBody>{state.conflictMessage}</MessageBarBody></MessageBar>}
      <div className="release-grid">
        <section className="panel release-main">
          <TabList selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}><Tab value="open">未关闭项目 <Badge>{blockers.length}</Badge></Tab><Tab value="repeat">重复缺陷 <Badge>2</Badge></Tab><Tab value="evidence">关键证据 <Badge>12</Badge></Tab></TabList>
          <div className="tab-body">
            {tab === 'open' && blockers.map((card) => <div className="review-item" key={card.id}><span className={`risk-icon ${card.status === '待授权' ? 'danger' : ''}`}><AlertRegular /></span><div><strong>{card.id} · {card.title}</strong><p>{card.finding || '工卡正在执行，完成后需由放行人员复核。'}</p><small>{card.zone} · 负责人 {card.executorName} · 要求证据 {card.evidence}</small></div><Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'warning'}>{card.status}</Badge></div>)}
            {tab === 'repeat' && <><div className="review-item"><span className="risk-icon danger"><HistoryRegular /></span><div><strong>液压系统压力偏低 · 第 3 次记录</strong><p>2026-08-16、09-02、09-29 均在系统 A 出现压力低于目标值。</p><small>建议移交可靠性分析，并关联历史排故记录。</small></div><Badge appearance="tint" color="danger">关键</Badge></div><div className="review-item"><span className="risk-icon"><HistoryRegular /></span><div><strong>APU 启动时间延长</strong><p>最近两次航线记录均略高于机队均值。</p><small>非放行阻塞项，建议后续监控。</small></div><Badge appearance="tint" color="warning">观察</Badge></div></>}
            {tab === 'evidence' && <div className="evidence-grid">{['液压系统测试记录.pdf', '发动机孔探照片_01.jpg', 'AD 执行签署页.pdf', '时寿件履历截图.png', '超差工程指令.pdf', '见证人签字单.pdf'].map((file) => <div className="evidence-tile" key={file}><DocumentBulletListRegular /><strong>{file}</strong><span>已绑定工卡 · 已核验</span></div>)}</div>}
          </div>
        </section>
        <aside className="release-side">
          <section className="panel signoff-card">
            <div className="panel-head"><div><h2>分阶段签字</h2><span>{activeRows.filter((item) => item.status === '已签署').length} / {Object.keys(STAGE_CARD).length}</span></div></div>
            {activeRows.map((row) => (
              <div className="signoff-row" key={row.id}>
                <div>
                  <span>{row.stage}阶段 · {row.cardId}</span>
                  {row.status === '已签署' && <>
                    <strong>{row.actor} {row.backfilled && <Badge size="small" appearance="tint" color="informative">已回填</Badge>}</strong>
                    <small>资质 {row.certNo || '无资质号'} · 有效期至 {row.certValidTo || '-'}{row.substituteFor ? ` · ${row.substituteFor}` : ''} · {row.time}</small>
                    <small className="evt">事件号 {row.eventId}</small>
                  </>}
                  {row.status === '待复核' && <>
                    <strong>{row.actor} <Badge size="small" appearance="tint" color="success">先到已生效</Badge></strong>
                    <small>后到待复核：{row.reviewCandidate?.actor} · 资质 {row.reviewCandidate?.certNo} · {row.reviewCandidate?.time}</small>
                    <small className="evt">事件号 {row.reviewCandidate?.eventId}</small>
                  </>}
                  {row.status === '待签署' && <>
                    <strong>待签署</strong>
                    <small>{row.invalidReason || '待指定有资质人员（登记资质号与有效期）'}</small>
                  </>}
                </div>
                {row.status === '已签署' && signatureBadge(row.status)}
                {row.status === '待复核' && <span className="review-actions"><Button size="small" appearance="secondary" onClick={() => dispatch(resolveReviewCandidate({ stage: row.stage, cardId: row.cardId, accept: false }))}>驳回</Button><Button size="small" appearance="primary" onClick={() => dispatch(resolveReviewCandidate({ stage: row.stage, cardId: row.cardId, accept: true }))}>采纳</Button></span>}
                {row.status === '待签署' && <Button size="small" appearance="primary" onClick={() => setDialogStage(row.stage)}>签署</Button>}
              </div>
            ))}
            {invalidatedRows.map((row) => (
              <div className="signoff-row invalidated" key={row.id}>
                <div><span>{row.stage}阶段 · {row.cardId} · 已失效</span><strong>{row.actor || '—'}</strong><small>{row.invalidReason}</small></div>
                {signatureBadge('已失效')}
              </div>
            ))}
          </section>
          <section className="panel release-gate-card">
            <LockClosedRegular />
            <h3>放行门禁</h3>
            <label><Checkbox checked={!blockers.some((card) => card.status === '待授权')} readOnly /> 无待授权超差项目</label>
            <label><Checkbox checked={state.cards.filter((card) => card.status === '已完成').length >= 6} readOnly /> 关键工卡完成率 ≥ 75%</label>
            <label><Checkbox checked={allSigned} readOnly /> 四个阶段均完成电子签署</label>
            <label><Checkbox checked={chainOk} readOnly /> 签字资质链完整（无过期 / 撤回 / 缺号）</label>
            <label><Checkbox checked={segregationOk} readOnly /> 质量阶段执行人与复核人非同一人</label>
            <label><Checkbox checked readOnly /> 审计记录和证据附件完整</label>
          </section>
          <ChainPanel />
          <BaselineCard />
        </aside>
      </div>
      <SignDialog open={dialogStage !== null} stage={dialogStage ?? ''} cardId={dialogStage ? STAGE_CARD[dialogStage] : ''} onClose={() => setDialogStage(null)} />
    </div>
  );
}

function Audit() {
  const state = useSelector((root: RootState) => root.maintenance);
  const [selected, setSelected] = useState('R7');
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
      <PageHeading eyebrow="AUDIT / VERSION CONTROL" title="审计与版本差异" description="对比工卡版本、查看操作历史并导出闭环证据；签字、资质、放行基线变更全程留痕。" actions={<Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={downloadAudit}>导出审计记录</Button>} />
      <div className="audit-grid">
        <section className="panel diff-panel"><div className="panel-head"><div><h2>工卡版本差异</h2><span>R6 → R7 · 3 处变更</span></div><select value={selected} onChange={(event) => setSelected(event.target.value)}><option>R7</option><option>R6</option><option>R5</option></select></div><div className="diff-table"><div className="diff-head"><span>工卡</span><span>字段</span><span>原值</span><span>新值 / 原因</span></div>{diffs.map((diff) => <div className="diff-row" key={`${diff.card}-${diff.field}`}><strong>{diff.card}</strong><span>{diff.field}</span><del>{diff.from}</del><div><ins>{diff.to}</ins><small>{diff.reason}</small></div></div>)}</div></section>
        <section className="panel audit-panel"><div className="panel-head"><div><h2>完整审计时间线</h2><span>{state.audit.length} 条记录</span></div><HistoryRegular /></div>{state.audit.map((item, index) => <div className="audit-row" key={`${item.time}-${index}`}><span className="timeline-dot" /><div><strong>{item.action}</strong><p>{item.detail}</p><small>{item.time} · {item.actor}</small></div></div>)}</section>
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
        <Shell><Routes><Route path="/" element={<Overview />} /><Route path="/execution" element={<Execution />} /><Route path="/release" element={<Release />} /><Route path="/audit" element={<Audit />} /><Route path="*" element={<NotFound />} /></Routes></Shell>
      </BrowserRouter>
    </FluentProvider>
  );
}
