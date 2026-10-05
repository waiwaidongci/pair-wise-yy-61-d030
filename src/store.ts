import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useDispatch } from 'react-redux';
import { maintenanceApi } from './api';
import {
  STAGES,
  backfillLegacy,
  buildBaseline,
  invalidateByScope,
  resolveSignatureAuth,
  type ActingRelation,
  type Personnel,
  type ReleaseBaseline,
  type Shift,
  type SignatureDraft,
  type SignatureRow,
  type SignRole,
  type StageId
} from './auth/domain';
import { CURRENT_SHIFT, legacyRows, seedPersonnel, seedRelations, seedShifts } from './auth/seed';

export type StageSignature = { stage: string; status: '待签署' | '已签署'; actor: string; time: string };
export type OfflineCard = {
  id: string;
  title: string;
  estimated: number;
  zone: string;
  dependencies: string[];
  tolerance: string;
  evidence: string;
  witness: string;
  status: '未开始' | '执行中' | '待授权' | '已完成';
  measurement: string;
  finding: string;
  stage: string;
  executorId?: string;
};

type AuditEntry = { time: string; actor: string; action: string; detail: string };

type MaintenanceState = {
  version: 2;
  currentUserId: string;
  currentShift: string;
  personnel: Personnel[];
  shifts: Shift[];
  relations: ActingRelation[];
  authVersion: number; // 授权范围版本：任何授权变化都会 +1
  signatures: SignatureRow[];
  drafts: SignatureDraft[];
  draftSeq: number;
  baseline?: ReleaseBaseline;
  cards: OfflineCard[];
  activeCardId: string;
  syncVersion: number;
  serverVersion: number;
  offline: boolean;
  writeFailures: boolean;
  lastSaved: string;
  conflictMessage: string;
  authMessage: string;
  released: boolean;
  audit: AuditEntry[];
};

const now = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const stamp = () => `2026-10-05 ${now()}`;
const nextEventId = (n: number) => `EVT-${6000 + n}`;

const initialCards: OfflineCard[] = [
  { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署', executorId: 'P01' },
  { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', status: '执行中', measurement: '', finding: '', stage: '发动机签署' },
  { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', status: '待授权', measurement: '2762 psi', finding: '低于容差，等待授权', stage: '系统签署', executorId: 'P03' },
  { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', status: '已完成', measurement: '剩余 836 循环', finding: '正常', stage: '适航签署' },
  { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', status: '未开始', measurement: '', finding: '', stage: '适航签署' },
  { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', status: '未开始', measurement: '', finding: '', stage: '客舱签署' },
  { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', status: '未开始', measurement: '', finding: '', stage: '动力签署' },
  { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署' }
];

function buildInitialState(): MaintenanceState {
  const base: MaintenanceState = {
    version: 2,
    currentUserId: 'P03',
    currentShift: CURRENT_SHIFT,
    personnel: seedPersonnel,
    shifts: seedShifts,
    relations: seedRelations,
    authVersion: 1,
    signatures: legacyRows,
    drafts: [],
    draftSeq: 0,
    baseline: undefined,
    cards: initialCards,
    activeCardId: 'CARD-03',
    syncVersion: 7,
    serverVersion: 7,
    offline: false,
    writeFailures: false,
    lastSaved: '09:46',
    conflictMessage: '',
    authMessage: '',
    released: false,
    audit: [
      { time: '08:40', actor: '赵明', action: '阶段签字（旧）', detail: '机械阶段执行签字，交班后仍挂在早班赵明名下，缺资质号' },
      { time: '08:54', actor: '赵明', action: '完成工卡', detail: 'CARD-01 间隙测量 1.62 mm' },
      { time: '09:05', actor: '宋杰', action: '提交测量', detail: 'CARD-03 压力 2762 psi，低于容差' },
      { time: '09:20', actor: '系统', action: '阻断', detail: 'CARD-03 等待授权处理' }
    ]
  };
  // 启动时对旧签字做班次名册回填；不通过的留待换签
  const results = base.signatures
    .filter((r) => r.legacy && !r.certNo)
    .map((row) => backfillLegacy(row, base.personnel, base.shifts));
  base.signatures = base.signatures.map((row) => results.find((r) => r.row.id === row.id)?.row ?? row);
  results.forEach((r) => base.audit.unshift({ time: '09:46', actor: '授权链', action: r.outcome === '回填成功' ? '旧签字回填' : '回填不通过', detail: r.detail }));
  return base;
}

const STORAGE_KEY = 'yy61-auth-chain-v2';
const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
const saved = raw ? (JSON.parse(raw) as MaintenanceState) : null;
const initialState: MaintenanceState = saved?.version === 2 ? saved : buildInitialState();

// 恢复上次"模拟写入失败"开关，保证刷新后草稿重试场景一致
if (typeof localStorage !== 'undefined' && initialState.writeFailures) {
  void import('./api').then(({ setFailWrites }) => setFailWrites(true));
}

let seqCounter = Math.max(0, ...initialState.signatures.map((r) => r.seq), 0);
const nextSeq = () => ++seqCounter;

// 授权范围变化后：未放行的相关有效/待复核签字回到待签，放行基线快照不动
function applyScopeChange(state: MaintenanceState, predicate: (r: SignatureRow) => boolean, reason: string) {
  // 已放行：授权链冻结，只保留基线快照，不再回改签字
  if (state.released) {
    state.audit.unshift({ time: now(), actor: '授权链', action: '授权变更（已放行）', detail: `${reason}；工作包已放行，基线快照保留，在线签字不再变更` });
    return;
  }
  const hit = state.signatures.filter((r) => (r.status === '有效' || r.status === '待复核') && predicate(r));
  const predicateScopes = new Set(hit.map((r) => r.scope));
  const predicatePersons = new Set(hit.map((r) => r.personId));
  state.signatures = invalidateByScope(state.signatures, predicate, reason);
  // 待复核也一并回到待签
  state.signatures = state.signatures.map((r) =>
    r.status === '待复核' && predicate(r) ? { ...r, status: '失效', invalidReason: reason } : r
  );
  // 命中的本地草稿删除，恢复后不允许按旧授权重试
  state.drafts = state.drafts.filter((d) => !(predicateScopes.has(d.stage) && predicatePersons.has(d.personId)));
  state.authVersion += 1;
  hit.forEach((r) =>
    state.audit.unshift({ time: now(), actor: '授权链', action: '签字失效回待签', detail: `${r.stage}阶段·${r.role}（${r.personName}）：${reason}` })
  );
  if (hit.length) state.authMessage = `授权范围已变更：${hit.map((r) => `${r.stage}·${r.role}`).join('、')} 签字失效，已回到待签。放行基线快照保留。`;
}

const slice = createSlice({
  name: 'maintenance',
  initialState,
  reducers: {
    selectCard(state, action: PayloadAction<string>) {
      state.activeCardId = action.payload;
    },
    updateCard(state, action: PayloadAction<Partial<OfflineCard> & { executorId?: string }>) {
      const card = state.cards.find((item) => item.id === state.activeCardId);
      if (!card) return;
      Object.assign(card, action.payload);
      state.syncVersion += 1;
      state.lastSaved = now();
      state.audit.unshift({ time: state.lastSaved, actor: '当前用户', action: '离线暂存', detail: `${card.id} 已保存本地草稿` });
    },
    setConflict(state, action: PayloadAction<string>) {
      state.conflictMessage = action.payload;
    },
    setAuthMessage(state, action: PayloadAction<string>) {
      state.authMessage = action.payload;
    },
    refreshVersion(state) {
      state.syncVersion = state.serverVersion;
      state.conflictMessage = '';
    },
    toggleOffline(state) {
      state.offline = !state.offline;
    },
    toggleWriteFailures(state) {
      state.writeFailures = !state.writeFailures;
    },
    switchUser(state, action: PayloadAction<string>) {
      state.currentUserId = action.payload;
      const person = state.personnel.find((p) => p.id === action.payload);
      state.audit.unshift({ time: now(), actor: person?.name ?? action.payload, action: '切换登录人', detail: `当前操作人切换为 ${person?.name ?? action.payload}` });
    },
    authorizeOverride(state) {
      const card = state.cards.find((item) => item.id === state.activeCardId);
      if (!card) return;
      card.status = '执行中';
      card.finding = '超差已由授权人员批准，按工程指令继续';
      state.audit.unshift({ time: now(), actor: '放行授权人', action: '授权继续', detail: `${card.id} 超差放行审批` });
    },

    // 1) 签字前登记草稿：人员、资质有效期、代班关系一并固化；失败原因留痕（授权判定在 thunk 中完成）
    saveDraft(
      state,
      action: PayloadAction<{ stage: StageId; role: SignRole; personId: string; certNo: string; validUntil: string; actingId?: string; reason: string }>
    ) {
      const p = action.payload;
      const existing = state.drafts.find((d) => d.stage === p.stage && d.role === p.role && d.personId === p.personId);
      if (existing) return;
      const eventId = nextEventId(++state.draftSeq);
      state.drafts.push({ eventId, stage: p.stage, role: p.role, personId: p.personId, time: stamp(), reason: p.reason, attempts: 0 });
      state.audit.unshift({ time: now(), actor: '授权链', action: '登记签字草稿', detail: `${eventId} ${p.stage}·${p.role} 资质 ${p.certNo}（有效期至 ${p.validUntil}）${p.actingId ? ` 代班 ${p.actingId}` : ''}` });
    },

    rejectSignature(state, action: PayloadAction<{ stage: StageId; role: SignRole; personId: string; reason: string }>) {
      const p = action.payload;
      const person = state.personnel.find((x) => x.id === p.personId);
      state.conflictMessage = `签字被授权链拦截：${p.reason}`;
      state.audit.unshift({ time: now(), actor: '授权链', action: '拒绝签字', detail: `${p.stage}阶段·${p.role}（${person?.name ?? p.personId}）：${p.reason}` });
    },

    // 2a) 先到：生效
    signatureAccepted(
      state,
      action: PayloadAction<{ eventId: string; stage: StageId; role: SignRole; personId: string; serverSeq: number; duplicate?: boolean }>
    ) {
      const draft = state.drafts.find((d) => d.eventId === action.payload.eventId);
      const person = state.personnel.find((p) => p.id === action.payload.personId)!;
      const qual = person.qualifications.find((q) => q.scope === action.payload.stage && q.active);
      const acting = state.relations.find((r) => r.substituteId === person.id && r.shift === state.currentShift && r.scope === action.payload.stage && r.active);
      // 幂等重放：同一 eventId 已落过签字，不新增
      if (state.signatures.some((r) => r.eventId === action.payload.eventId)) {
        state.drafts = state.drafts.filter((d) => d.eventId !== action.payload.eventId);
        return;
      }
      state.signatures.push({
        id: `SIG-${action.payload.serverSeq}`,
        eventId: action.payload.eventId,
        stage: action.payload.stage,
        role: action.payload.role,
        personId: person.id,
        personName: person.name,
        certNo: qual?.certNo,
        scope: action.payload.stage,
        qualValidUntil: qual?.validUntil,
        actingId: acting?.id,
        shift: state.currentShift,
        time: draft?.time ?? stamp(),
        seq: nextSeq(),
        status: '有效'
      });
      state.drafts = state.drafts.filter((d) => d.eventId !== action.payload.eventId);
      state.audit.unshift({
        time: now(),
        actor: person.name,
        action: action.payload.duplicate ? '签字重试确认（幂等）' : '阶段签字生效',
        detail: `${action.payload.stage}阶段·${action.payload.role} 生效，资质 ${qual?.certNo ?? '无'} 有效期至 ${qual?.validUntil ?? '-'}${acting ? `，凭代班 ${acting.id}` : ''}`
      });
    },

    // 2b) 后到：保留待复核（槽位已被先到签字占用）
    signaturePending(
      state,
      action: PayloadAction<{ eventId: string; stage: StageId; role: SignRole; personId: string; reason: string }>
    ) {
      const draft = state.drafts.find((d) => d.eventId === action.payload.eventId);
      const person = state.personnel.find((p) => p.id === action.payload.personId)!;
      if (state.signatures.some((r) => r.eventId === action.payload.eventId)) return;
      const qual = person.qualifications.find((q) => q.scope === action.payload.stage && q.active);
      const acting = state.relations.find((r) => r.substituteId === person.id && r.shift === state.currentShift && r.scope === action.payload.stage && r.active);
      state.signatures.push({
        id: `SIG-P${nextSeq()}`,
        eventId: action.payload.eventId,
        stage: action.payload.stage,
        role: action.payload.role,
        personId: person.id,
        personName: person.name,
        certNo: qual?.certNo,
        scope: action.payload.stage,
        qualValidUntil: qual?.validUntil,
        actingId: acting?.id,
        shift: state.currentShift,
        time: draft?.time ?? stamp(),
        seq: nextSeq(),
        status: '待复核',
        pendingReason: action.payload.reason
      });
      state.drafts = state.drafts.filter((d) => d.eventId !== action.payload.eventId);
      state.audit.unshift({ time: now(), actor: person.name, action: '签字待复核', detail: `${action.payload.stage}阶段·${action.payload.role}：${action.payload.reason}` });
    },

    // 2c) 写入失败：保留原草稿与事件号，attempts+1（恢复后按同 eventId 重试，不会多签）
    signatureWriteFailed(state, action: PayloadAction<{ eventId: string }>) {
      const draft = state.drafts.find((d) => d.eventId === action.payload.eventId);
      if (draft) draft.attempts += 1;
      state.audit.unshift({ time: now(), actor: '系统', action: '签字写入失败', detail: `${action.payload.eventId} 草稿保留（第 ${draft?.attempts ?? 1} 次尝试），恢复后按原事件号重试` });
    },

    // 待复核签字经复核确认后生效（仅当槽位无先生效签字；有先生效签字时应驳回）
    confirmPending(state, action: PayloadAction<string>) {
      const row = state.signatures.find((r) => r.id === action.payload);
      if (!row || row.status !== '待复核') return;
      const occupied = state.signatures.some((r) => r.stage === row.stage && r.role === row.role && r.status === '有效' && r.id !== row.id);
      if (occupied) { state.conflictMessage = '该槽位已有先生效签字，后到提交只能驳回，不能再生效。'; return; }
      const auth = resolveSignatureAuth({
        stage: row.stage, role: row.role, personId: row.personId,
        personnel: state.personnel, shifts: state.shifts, currentShiftName: state.currentShift,
        relations: state.relations, signatures: state.signatures, cards: state.cards
      });
      if (!auth.ok) { state.conflictMessage = `复核确认被拦截：${auth.reason}`; return; }
      row.status = '有效';
      row.pendingReason = undefined;
      state.audit.unshift({ time: now(), actor: '授权链', action: '待复核确认生效', detail: `${row.eventId} ${row.stage}·${row.role}（${row.personName}）经复核后生效` });
    },

    // 后到提交经复核驳回：回到待签（槽位由先到签字保持）
    dismissPending(state, action: PayloadAction<{ rowId: string; note: string }>) {
      const row = state.signatures.find((r) => r.id === action.payload.rowId);
      if (!row || row.status !== '待复核') return;
      row.status = '失效';
      row.pendingReason = undefined;
      row.invalidReason = `复核驳回：${action.payload.note}`;
      state.audit.unshift({ time: now(), actor: '授权链', action: '后到签字驳回', detail: `${row.eventId} ${row.stage}·${row.role}（${row.personName}）驳回：${action.payload.note}` });
    },

    // 待换签旧签字：先标记被替代，再由换签流程重新走授权链
    markLegacySuperseded(state, action: PayloadAction<string>) {
      const row = state.signatures.find((r) => r.id === action.payload);
      if (!row || row.status !== '待换签') return;
      row.status = '失效';
      row.invalidReason = `已由换签替代（${stamp()}）`;
      state.authVersion += 1;
    },

    // 3a) 撤回资质
    revokeQualification(state, action: PayloadAction<{ personId: string; scope: StageId }>) {
      const person = state.personnel.find((p) => p.id === action.payload.personId);
      const qual = person?.qualifications.find((q) => q.scope === action.payload.scope);
      if (!person || !qual) return;
      qual.active = false;
      applyScopeChange(
        state,
        (r) => r.scope === action.payload.scope && r.personId === person.id,
        `${person.name} 的 ${action.payload.scope} 资质 ${qual.certNo} 已撤回`
      );
    },

    // 3b) 换岗：人员离开当前班次，其未放行签字失效
    transferPerson(state, action: PayloadAction<{ personId: string; toShift: string }>) {
      const person = state.personnel.find((p) => p.id === action.payload.personId);
      if (!person) return;
      const from = person.shift;
      person.shift = action.payload.toShift;
      applyScopeChange(
        state,
        (r) => r.personId === person.id,
        `${person.name} 已从 ${from} 换岗至 ${action.payload.toShift}，原班次授权终止`
      );
    },

    // 3c) 代班关系停用
    deactivateActing(state, action: PayloadAction<string>) {
      const rel = state.relations.find((r) => r.id === action.payload);
      if (!rel) return;
      rel.active = false;
      applyScopeChange(
        state,
        (r) => r.actingId === rel.id,
        `代班关系 ${rel.id}（${rel.shift} · ${rel.scope}）已停用`
      );
    },

    // 3d) 交班：进入下一班次（旧签字归属不变，但新签字需在新班次授权链内）
    handoverShift(state, action: PayloadAction<string>) {
      const previous = state.currentShift;
      state.currentShift = action.payload;
      state.authVersion += 1;
      state.audit.unshift({ time: now(), actor: '授权链', action: '班次交接', detail: `${previous} 交班，当前班次变更为 ${action.payload}` });
    },

    releasePackage(state) {
      if (state.released) return;
      const gates = buildBaseline(state.signatures, state.cards, state.serverVersion, stamp()).gates;
      if (gates.some((g) => !g.pass)) {
        state.conflictMessage = `放行门禁未通过：${gates.filter((g) => !g.pass).map((g) => g.label).join('、')}`;
        state.audit.unshift({ time: now(), actor: '放行基线', action: '拒绝放行', detail: state.conflictMessage });
        return;
      }
      const baseline = buildBaseline(state.signatures, state.cards, state.serverVersion, stamp());
      state.baseline = baseline;
      state.released = true;
      state.conflictMessage = '';
      state.audit.unshift({ time: now(), actor: '质量经理', action: '锁定放行', detail: `工作包 R${state.serverVersion} 已锁定，${baseline.snapshot.length} 个签字进入只读放行快照` });
    },

    resetDemo() {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
      return buildInitialState();
    }
  }
});

export const {
  selectCard, updateCard, setConflict, setAuthMessage, refreshVersion, toggleOffline, toggleWriteFailures,
  switchUser, authorizeOverride, saveDraft, rejectSignature, signatureAccepted, signaturePending, signatureWriteFailed,
  confirmPending, dismissPending, markLegacySuperseded, revokeQualification, transferPerson, deactivateActing, handoverShift,
  releasePackage, resetDemo
} = slice.actions;

export const store = configureStore({
  reducer: { maintenance: slice.reducer, [maintenanceApi.reducerPath]: maintenanceApi.reducer },
  middleware: (getDefault) => getDefault().concat(maintenanceApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getState().maintenance));
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();

// 选择器：给 UI 的实时授权判定
export const selectAuth = (state: RootState, stage: StageId, role: SignRole, personId?: string) =>
  resolveSignatureAuth({
    stage, role, personId: personId ?? state.maintenance.currentUserId,
    personnel: state.maintenance.personnel,
    shifts: state.maintenance.shifts,
    currentShiftName: state.maintenance.currentShift,
    relations: state.maintenance.relations,
    signatures: state.maintenance.signatures,
    cards: state.maintenance.cards
  });

export { STAGES };
