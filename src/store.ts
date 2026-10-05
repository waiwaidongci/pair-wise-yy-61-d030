import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { maintenanceApi } from './api';

// ---------- 授权链基础类型 ----------
export type Qualification = {
  id: string;          // 资质号
  type: string;        // 资质类型
  scope: string[];     // 授权阶段范围
  validFrom: string;
  validTo: string;     // 资质有效期
  status: '有效' | '撤回' | '换岗';
};

export type Person = {
  id: string;
  name: string;
  role: string;        // 岗位
  shift: string;       // 班次
  qualifications: Qualification[];
  actingFor: { personId: string; personName: string; scope: string[]; validTo: string } | null; // 代班关系
};

export type SignatureStatus = '待签署' | '已签署' | '待复核' | '已失效';

export type ReviewCandidate = {
  eventId: string;
  actorId: string;
  actor: string;
  certNo: string;
  certType: string;
  certValidTo: string;
  substituteFor: string;
  time: string;
};

export type StageSignature = {
  id: string;
  stage: string;
  cardId: string;
  status: SignatureStatus;
  actorId: string;
  actor: string;
  certNo: string;         // 签字时登记的资质号
  certType: string;
  certValidTo: string;    // 签字时登记的资质有效期（快照）
  substituteFor: string;  // 代班关系
  time: string;
  eventId: string;        // 事件号（幂等键）
  invalidReason: string;
  reviewCandidate: ReviewCandidate | null; // 后到待复核的签字草稿
  backfilled: boolean;    // 是否由旧签字回填资质号而来
};

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
  executorId: string;     // 执行人（质量阶段复核人不得与执行人同一人）
  executorName: string;
};

export type ReleaseBaseline = {
  revision: number;
  releasedAt: string;
  releasedBy: string;
  cards: OfflineCard[];
  signatures: StageSignature[];
  personnel: Person[];
};

export type PendingWrite = {
  eventId: string;
  kind: 'sign';
  stage: string;
  cardId: string;
  draft: ReviewCandidate; // 写入失败保留的原签字草稿
  attempts: number;
  lastError: string;
  time: string;
};

type MaintenanceState = {
  cards: OfflineCard[];
  activeCardId: string;
  currentUserId: string;
  shift: string;
  syncVersion: number;
  serverVersion: number;
  offline: boolean;
  lastSaved: string;
  conflictMessage: string;
  signatures: StageSignature[];
  personnel: Person[];
  pendingWrites: PendingWrite[];
  released: boolean;
  baseline: ReleaseBaseline | null;
  audit: { time: string; actor: string; action: string; detail: string }[];
};

// ---------- 授权链常量 ----------
export const AUTH_TODAY = '2026-09-29'; // 资质有效期判定基准（定检当日）
export const REVIEW_STAGES = ['放行'];  // 质量复核阶段：执行人与复核人不得为同一人
export const STAGE_CARD: Record<string, string> = { 机械: 'CARD-01', 系统: 'CARD-03', 动力: 'CARD-07', 放行: 'CARD-08' };

export function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function findQualForStage(person: Person | undefined, stage: string): Qualification | undefined {
  if (!person) return undefined;
  return person.qualifications.find(
    (q) => q.status === '有效' && q.scope.includes(stage) && q.validFrom <= AUTH_TODAY && q.validTo >= AUTH_TODAY
  );
}

export function findActingFor(person: Person | undefined, stage: string) {
  if (!person?.actingFor) return undefined;
  const acting = person.actingFor;
  if (acting.scope.includes(stage) && acting.validTo >= AUTH_TODAY) return acting;
  return undefined;
}

export type SignValidation =
  | { ok: true; person: Person; qual: Qualification; substitute: string }
  | { ok: false; reason: string };

// 签字授权校验：人员在班、资质有效且覆盖阶段、代班关系有效、质量阶段执行/复核分离
export function validateSign(state: MaintenanceState, stage: string, cardId: string, actorId: string): SignValidation {
  const person = state.personnel.find((p) => p.id === actorId);
  if (!person) return { ok: false, reason: `人员 ${actorId} 不在班次名册中，无法签字。` };
  const qual = findQualForStage(person, stage);
  const acting = findActingFor(person, stage);
  if (!qual && !acting) {
    const expired = person.qualifications.some((q) => q.scope.includes(stage) && q.validTo < AUTH_TODAY);
    const revoked = person.qualifications.some((q) => q.scope.includes(stage) && q.status === '撤回');
    const transferred = person.qualifications.some((q) => q.scope.includes(stage) && q.status === '换岗');
    if (expired) return { ok: false, reason: `${person.name} 的 ${stage} 资质已过期（有效期至 ${person.qualifications.find((q) => q.scope.includes(stage))?.validTo}），签字无效。` };
    if (revoked) return { ok: false, reason: `${person.name} 的 ${stage} 资质已被撤回，签字无效。` };
    if (transferred) return { ok: false, reason: `${person.name} 已换岗，${stage} 资质标记失效，签字无效。` };
    return { ok: false, reason: `${person.name} 无 ${stage} 阶段的有效资质，也无代班授权。` };
  }
  const card = state.cards.find((c) => c.id === cardId);
  if (REVIEW_STAGES.includes(stage) && card?.executorId === actorId) {
    return { ok: false, reason: `质量阶段（${stage}）复核人不能与执行人 ${person.name} 为同一人。` };
  }
  return { ok: true, person, qual: qual as Qualification, substitute: !qual && acting ? `${acting.personName}（代班）` : '' };
}

function emptySignature(stage: string, cardId: string): StageSignature {
  return {
    id: `SIG-${stage}-${cardId}-${Date.now()}`,
    stage,
    cardId,
    status: '待签署',
    actorId: '',
    actor: '',
    certNo: '',
    certType: '',
    certValidTo: '',
    substituteFor: '',
    time: '',
    eventId: '',
    invalidReason: '',
    reviewCandidate: null,
    backfilled: false
  };
}

// 授权范围变化：未放行工卡的相关签字立即失效并回到待签；已放行基线保留快照
function invalidateSignatures(state: MaintenanceState, pred: (s: StageSignature) => boolean, reason: string) {
  if (state.baseline) {
    state.audit.unshift({ time: nowTime(), actor: '系统', action: '基线保留', detail: '工作包已放行，授权变更不影响已锁定基线快照' });
    return;
  }
  const targets = state.signatures.filter((s) => s.status === '已签署' && pred(s));
  for (const row of targets) {
    row.status = '已失效';
    row.invalidReason = reason;
    state.audit.unshift({ time: nowTime(), actor: '系统', action: '签字失效', detail: `${row.cardId} ${row.stage}：${reason}` });
    const exists = state.signatures.some((s) => s.stage === row.stage && s.cardId === row.cardId && s.status !== '已失效');
    if (!exists) state.signatures.push(emptySignature(row.stage, row.cardId));
  }
}

// ---------- 初始数据 ----------
const initialCards: OfflineCard[] = [
  { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署', executorId: 'U-01', executorName: '宋杰' },
  { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', status: '执行中', measurement: '', finding: '', stage: '发动机签署', executorId: 'U-01', executorName: '宋杰' },
  { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', status: '待授权', measurement: '2762 psi', finding: '低于容差，等待授权', stage: '系统签署', executorId: 'U-01', executorName: '宋杰' },
  { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', status: '已完成', measurement: '剩余 836 循环', finding: '正常', stage: '适航签署', executorId: 'U-01', executorName: '宋杰' },
  { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', status: '未开始', measurement: '', finding: '', stage: '适航签署', executorId: 'U-05', executorName: '李强' },
  { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', status: '未开始', measurement: '', finding: '', stage: '客舱签署', executorId: 'U-07', executorName: '陈静' },
  { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', status: '未开始', measurement: '', finding: '', stage: '动力签署', executorId: 'U-01', executorName: '宋杰' },
  { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署', executorId: 'U-04', executorName: '周敏' }
];

const initialPersonnel: Person[] = [
  { id: 'U-01', name: '宋杰', role: '机械员', shift: '白班', qualifications: [
    { id: 'ZJ-2023-0417', type: '机械检验', scope: ['机械'], validFrom: '2025-03-01', validTo: '2027-02-28', status: '有效' }
  ], actingFor: null },
  { id: 'U-02', name: '赵明', role: '机械员', shift: '白班', qualifications: [
    { id: 'ZJ-2022-0105', type: '机械检验', scope: ['机械', '系统'], validFrom: '2024-06-01', validTo: '2026-10-31', status: '有效' }
  ], actingFor: null },
  { id: 'U-03', name: '孙丽', role: '检验员', shift: '白班', qualifications: [
    { id: 'ZJ-2024-0211', type: '质量检验', scope: ['系统', '动力'], validFrom: '2025-01-15', validTo: '2028-01-14', status: '有效' }
  ], actingFor: null },
  { id: 'U-04', name: '周敏', role: '质量经理', shift: '白班', qualifications: [
    { id: 'ZJ-2021-0088', type: '放行授权', scope: ['放行'], validFrom: '2023-01-01', validTo: '2026-09-30', status: '有效' }
  ], actingFor: null },
  { id: 'U-05', name: '李强', role: '放行人员', shift: '白班', qualifications: [
    { id: 'ZJ-2020-0032', type: '放行授权', scope: ['放行'], validFrom: '2022-05-01', validTo: '2027-04-30', status: '有效' }
  ], actingFor: null },
  { id: 'U-06', name: '王磊', role: '机械员', shift: '夜班', qualifications: [
    { id: 'ZJ-2023-0777', type: '机械检验', scope: ['机械'], validFrom: '2024-09-01', validTo: '2026-08-31', status: '有效' }
  ], actingFor: null },
  { id: 'U-07', name: '陈静', role: '检验员', shift: '白班', qualifications: [
    { id: 'ZJ-2025-0301', type: '质量检验', scope: ['系统', '动力'], validFrom: '2025-06-01', validTo: '2027-05-31', status: '有效' }
  ], actingFor: { personId: 'U-03', personName: '孙丽', scope: ['系统'], validTo: '2026-10-15' } }
];

const initialSignatures: StageSignature[] = [
  { id: 'SIG-机械', stage: '机械', cardId: 'CARD-01', status: '已签署', actorId: 'U-02', actor: '赵明', certNo: '', certType: '', certValidTo: '', substituteFor: '', time: '09:18', eventId: 'EVT-LEGACY-001', invalidReason: '', reviewCandidate: null, backfilled: false },
  { id: 'SIG-系统', stage: '系统', cardId: 'CARD-03', status: '待签署', actorId: '', actor: '', certNo: '', certType: '', certValidTo: '', substituteFor: '', time: '', eventId: '', invalidReason: '', reviewCandidate: null, backfilled: false },
  { id: 'SIG-动力', stage: '动力', cardId: 'CARD-07', status: '已签署', actorId: '', actor: '钱进', certNo: '', certType: '', certValidTo: '', substituteFor: '', time: '08:05', eventId: 'EVT-LEGACY-002', invalidReason: '', reviewCandidate: null, backfilled: false },
  { id: 'SIG-放行', stage: '放行', cardId: 'CARD-08', status: '待签署', actorId: '', actor: '', certNo: '', certType: '', certValidTo: '', substituteFor: '', time: '', eventId: '', invalidReason: '', reviewCandidate: null, backfilled: false }
];

const initialAudit = [
  { time: '08:05', actor: '钱进', action: '阶段签署', detail: 'CARD-07 动力阶段确认（历史签字，资质号待回填）' },
  { time: '08:54', actor: '赵明', action: '完成工卡', detail: 'CARD-01 间隙测量 1.62 mm' },
  { time: '09:05', actor: '宋杰', action: '提交测量', detail: 'CARD-03 压力 2762 psi，低于容差' },
  { time: '09:18', actor: '赵明', action: '阶段签署', detail: 'CARD-01 机械阶段确认（历史签字，资质号待回填）' },
  { time: '09:20', actor: '系统', action: '阻断', detail: 'CARD-03 等待授权处理' }
];

export function buildInitialState(): MaintenanceState {
  return {
    cards: initialCards.map((c) => ({ ...c })),
    activeCardId: 'CARD-03',
    currentUserId: 'U-01',
    shift: '白班',
    syncVersion: 7,
    serverVersion: 7,
    offline: false,
    lastSaved: '09:46',
    conflictMessage: '',
    signatures: initialSignatures.map((s) => ({ ...s })),
    personnel: initialPersonnel.map((p) => ({ ...p, qualifications: p.qualifications.map((q) => ({ ...q })) })),
    pendingWrites: [],
    released: false,
    baseline: null,
    audit: initialAudit.map((a) => ({ ...a }))
  };
}

const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('yy61-work-package-v2') : null;
const saved = raw ? JSON.parse(raw) : null;
const initialState: MaintenanceState = saved ? { ...buildInitialState(), ...saved, conflictMessage: '', pendingWrites: saved.pendingWrites ?? [] } : buildInitialState();

const slice = createSlice({
  name: 'maintenance',
  initialState,
  reducers: {
    selectCard(state, action: PayloadAction<string>) {
      state.activeCardId = action.payload;
    },
    updateCard(state, action: PayloadAction<Partial<OfflineCard>>) {
      const card = state.cards.find((item) => item.id === state.activeCardId);
      if (!card) return;
      Object.assign(card, action.payload);
      state.syncVersion += 1;
      state.lastSaved = nowTime();
      state.audit.unshift({ time: state.lastSaved, actor: '当前用户', action: '离线暂存', detail: `${card.id} 已保存本地草稿` });
    },
    setConflict(state, action: PayloadAction<string>) {
      state.conflictMessage = action.payload;
    },
    refreshVersion(state) {
      state.syncVersion = state.serverVersion;
      state.conflictMessage = '';
    },
    toggleOffline(state) {
      state.offline = !state.offline;
    },
    authorizeOverride(state) {
      const card = state.cards.find((item) => item.id === state.activeCardId);
      if (!card) return;
      card.status = '执行中';
      card.finding = '超差已由授权人员批准，按工程指令继续';
      state.audit.unshift({ time: nowTime(), actor: '放行授权人', action: '授权继续', detail: `${card.id} 超差放行审批` });
    },

    // 阶段签字：登记人员、资质有效期、代班关系；先到生效，后到待复核
    signStage(state, action: PayloadAction<{ stage: string; cardId: string; actorId: string; eventId: string; forceFail?: boolean }>) {
      const { stage, cardId, actorId, eventId, forceFail } = action.payload;
      // 幂等：事件号已生效，绝不重复签字
      if (state.signatures.some((s) => s.eventId === eventId)) {
        state.conflictMessage = `事件号 ${eventId} 已生效，未重复签字。`;
        return;
      }
      const row = state.signatures.find((s) => s.stage === stage && s.cardId === cardId && s.status !== '已失效');
      if (!row) return;
      if (row.status === '待复核') {
        state.conflictMessage = `${stage} 阶段已有待复核签字（${row.reviewCandidate?.actor}），请先采纳或驳回。`;
        return;
      }
      const validation = validateSign(state, stage, cardId, actorId);
      if (!validation.ok) {
        state.conflictMessage = validation.reason;
        state.audit.unshift({ time: nowTime(), actor: '系统', action: '阻断签署', detail: `${cardId} ${stage}：${validation.reason}` });
        return;
      }
      const { person, qual, substitute } = validation;
      const acting = findActingFor(person, stage);
      const draft: ReviewCandidate = {
        eventId,
        actorId,
        actor: person.name,
        certNo: qual?.id ?? (acting ? `代班-${acting.personName}` : ''),
        certType: qual?.type ?? (acting ? '代班授权' : ''),
        certValidTo: qual?.validTo ?? acting?.validTo ?? '',
        substituteFor: substitute,
        time: nowTime()
      };
      // 写入失败：保留原签字草稿与事件号，恢复后可重试
      if (forceFail) {
        state.pendingWrites.unshift({ eventId, kind: 'sign', stage, cardId, draft, attempts: 1, lastError: '写入失败：签字服务暂时不可用，草稿与事件号已保留。', time: draft.time });
        state.conflictMessage = `写入失败：${stage} 签字草稿已保留（事件号 ${eventId}），恢复后可重试，不会重复签字。`;
        state.audit.unshift({ time: draft.time, actor: '系统', action: '写入失败', detail: `${cardId} ${stage}：草稿已保留 ${eventId}` });
        return;
      }
      if (row.status === '已签署') {
        // 两名检验员同时提交：先到生效，后到保留待复核
        row.reviewCandidate = draft;
        row.status = '待复核';
        state.audit.unshift({ time: draft.time, actor: person.name, action: '待复核', detail: `${cardId} ${stage}：${row.actor} 先到已生效，${person.name} 后到保留待复核（${eventId}）` });
        return;
      }
      // 待签署 / 已失效 → 签字生效
      row.status = '已签署';
      row.actorId = draft.actorId;
      row.actor = draft.actor;
      row.certNo = draft.certNo;
      row.certType = draft.certType;
      row.certValidTo = draft.certValidTo;
      row.substituteFor = draft.substituteFor;
      row.time = draft.time;
      row.eventId = eventId;
      row.invalidReason = '';
      row.reviewCandidate = null;
      state.audit.unshift({ time: draft.time, actor: person.name, action: '阶段签署', detail: `${cardId} ${stage}：${person.name}（${draft.certNo}，有效期至 ${draft.certValidTo}${substitute ? `，${substitute}` : ''}）${eventId}` });
    },

    // 待复核签字：采纳（后到生效）或驳回（保留先到）
    resolveReviewCandidate(state, action: PayloadAction<{ stage: string; cardId: string; accept: boolean }>) {
      const row = state.signatures.find((s) => s.stage === action.payload.stage && s.cardId === action.payload.cardId && s.status !== '已失效');
      if (!row || !row.reviewCandidate) return;
      const candidate = row.reviewCandidate;
      if (action.payload.accept) {
        row.actorId = candidate.actorId;
        row.actor = candidate.actor;
        row.certNo = candidate.certNo;
        row.certType = candidate.certType;
        row.certValidTo = candidate.certValidTo;
        row.substituteFor = candidate.substituteFor;
        row.time = candidate.time;
        row.eventId = candidate.eventId;
        state.audit.unshift({ time: nowTime(), actor: '质量经理', action: '采纳待复核签字', detail: `${row.cardId} ${row.stage}：采纳 ${candidate.actor}（${candidate.eventId}）` });
      } else {
        state.audit.unshift({ time: nowTime(), actor: '质量经理', action: '驳回复核签字', detail: `${row.cardId} ${row.stage}：驳回 ${candidate.actor}（${candidate.eventId}），保留原签字` });
      }
      row.reviewCandidate = null;
      row.status = '已签署';
    },

    // 资质撤回：未放行工卡相关签字立即失效并回到待签
    revokeQualification(state, action: PayloadAction<{ personId: string; qualId: string; reason: string }>) {
      const person = state.personnel.find((p) => p.id === action.payload.personId);
      const qual = person?.qualifications.find((q) => q.id === action.payload.qualId);
      if (!person || !qual) return;
      qual.status = '撤回';
      state.audit.unshift({ time: nowTime(), actor: '系统', action: '撤回资质', detail: `${person.name} ${qual.id}（${qual.type}）：${action.payload.reason}` });
      invalidateSignatures(state, (s) => s.certNo === qual.id || s.actorId === person.id, `资质 ${qual.id} 已撤回`);
    },

    // 人员换岗：授权范围变化，相关签字失效
    transferPerson(state, action: PayloadAction<{ personId: string; toRole: string; toShift: string }>) {
      const person = state.personnel.find((p) => p.id === action.payload.personId);
      if (!person) return;
      person.role = action.payload.toRole;
      person.shift = action.payload.toShift;
      person.qualifications.forEach((q) => {
        if (q.status === '有效') q.status = '换岗';
      });
      state.audit.unshift({ time: nowTime(), actor: '系统', action: '人员换岗', detail: `${person.name} → ${action.payload.toRole} / ${action.payload.toShift}，在班资质标记换岗` });
      invalidateSignatures(state, (s) => s.actorId === person.id, `${person.name} 已换岗，授权范围变化`);
    },

    // 班次交班：重新核验在班人员、资质有效期与签字；已放行基线保留快照
    handoffShift(state) {
      const next = state.shift === '白班' ? '夜班' : '白班';
      state.shift = next;
      state.audit.unshift({ time: nowTime(), actor: '系统', action: '班次交班', detail: `交班至${next}，重新核验在班人员签字与资质` });
      if (state.baseline) {
        state.audit.unshift({ time: nowTime(), actor: '系统', action: '基线保留', detail: '工作包已放行，交班不影响已锁定基线快照' });
        return;
      }
      const rows = state.signatures.filter((s) => s.status === '已签署');
      for (const row of rows) {
        const person = state.personnel.find((p) => p.id === row.actorId);
        const onShift = person?.shift === next;
        const qualValid = row.certNo
          ? person?.qualifications.some((q) => q.id === row.certNo && q.status === '有效' && q.validTo >= AUTH_TODAY)
          : false;
        if (person && onShift && qualValid) continue;
        // 旧签字无资质号：按班次名册回填
        if (!row.certNo && person && onShift) {
          const qual = findQualForStage(person, row.stage);
          if (qual) {
            row.certNo = qual.id;
            row.certType = qual.type;
            row.certValidTo = qual.validTo;
            row.backfilled = true;
            state.audit.unshift({ time: nowTime(), actor: '系统', action: '回填资质号', detail: `${row.cardId} ${row.stage}：按名册回填 ${person.name} ${qual.id}` });
            continue;
          }
        }
        row.status = '已失效';
        row.invalidReason = `交班复核：签字人不在${next}或资质已失效`;
        state.audit.unshift({ time: nowTime(), actor: '系统', action: '签字失效', detail: `${row.cardId} ${row.stage}：${row.invalidReason}` });
        const exists = state.signatures.some((s) => s.stage === row.stage && s.cardId === row.cardId && s.status !== '已失效');
        if (!exists) state.signatures.push(emptySignature(row.stage, row.cardId));
      }
    },

    // 旧签字按班次名册回填资质号；回填不通过留待换签
    backfillSignatures(state) {
      let filled = 0;
      let failed = 0;
      for (const row of state.signatures) {
        if (row.status !== '已签署' || row.certNo) continue;
        const person = state.personnel.find((p) => p.name === row.actor);
        const qual = person ? findQualForStage(person, row.stage) : undefined;
        if (person && qual) {
          row.actorId = person.id;
          row.certNo = qual.id;
          row.certType = qual.type;
          row.certValidTo = qual.validTo;
          row.backfilled = true;
          filled += 1;
          state.audit.unshift({ time: nowTime(), actor: '系统', action: '回填资质号', detail: `${row.cardId} ${row.stage}：按名册回填 ${row.actor} ${qual.id}（有效期至 ${qual.validTo}）` });
        } else {
          row.status = '待签署';
          row.invalidReason = '待换签：班次名册中无该人员有效资质';
          failed += 1;
          state.audit.unshift({ time: nowTime(), actor: '系统', action: '留待换签', detail: `${row.cardId} ${row.stage}：${row.actor} 不在名册或无有效资质，退回待签` });
        }
      }
      state.conflictMessage = `回填完成：${filled} 条已回填资质号，${failed} 条留待换签。`;
    },

    // 写入失败后重试：草稿与事件号不变，幂等不重复签字
    retryPendingWrite(state, action: PayloadAction<string>) {
      const pending = state.pendingWrites.find((p) => p.eventId === action.payload);
      if (!pending) return;
      if (state.signatures.some((s) => s.eventId === pending.eventId)) {
        state.pendingWrites = state.pendingWrites.filter((p) => p.eventId !== pending.eventId);
        state.conflictMessage = `事件号 ${pending.eventId} 已生效，未重复签字。`;
        return;
      }
      const validation = validateSign(state, pending.stage, pending.cardId, pending.draft.actorId);
      if (!validation.ok) {
        pending.attempts += 1;
        pending.lastError = validation.reason;
        state.conflictMessage = `重试仍被阻断：${validation.reason}`;
        return;
      }
      const row = state.signatures.find((s) => s.stage === pending.stage && s.cardId === pending.cardId && s.status !== '已失效');
      if (!row) {
        state.pendingWrites = state.pendingWrites.filter((p) => p.eventId !== pending.eventId);
        return;
      }
      if (row.status === '已签署') {
        row.reviewCandidate = { ...pending.draft, time: nowTime() };
        row.status = '待复核';
      } else {
        row.status = '已签署';
        row.actorId = pending.draft.actorId;
        row.actor = pending.draft.actor;
        row.certNo = pending.draft.certNo;
        row.certType = pending.draft.certType;
        row.certValidTo = pending.draft.certValidTo;
        row.substituteFor = pending.draft.substituteFor;
        row.time = nowTime();
        row.eventId = pending.eventId;
        row.invalidReason = '';
        row.reviewCandidate = null;
      }
      state.pendingWrites = state.pendingWrites.filter((p) => p.eventId !== pending.eventId);
      state.audit.unshift({ time: nowTime(), actor: pending.draft.actor, action: '重试成功', detail: `${pending.cardId} ${pending.stage}：草稿 ${pending.eventId} 已写入，未重复签字` });
    },

    // 放行：门禁校验授权链，通过后锁定并形成基线快照
    releasePackage(state) {
      if (state.released) return;
      const hasBlockers = state.cards.some((card) => card.status === '待授权');
      const activeRows = state.signatures.filter((s) => s.status !== '已失效');
      const allSigned = activeRows.length === Object.keys(STAGE_CARD).length && activeRows.every((item) => item.status === '已签署');
      const chainBroken = activeRows.some((s) => {
        if (s.status !== '已签署' || !s.certNo) return true;
        const person = state.personnel.find((p) => p.id === s.actorId);
        const qual = person?.qualifications.find((q) => q.id === s.certNo);
        return !qual || qual.status !== '有效' || qual.validTo < AUTH_TODAY;
      });
      if (hasBlockers || !allSigned || chainBroken) {
        state.conflictMessage = '放行门禁未通过：存在未关闭项目、未签署阶段或签字资质链断裂（无资质号 / 资质过期 / 已撤回）。';
        state.audit.unshift({ time: nowTime(), actor: '系统', action: '阻断放行', detail: '授权链门禁未通过，基线未形成' });
        return;
      }
      state.released = true;
      state.baseline = {
        revision: state.serverVersion,
        releasedAt: nowTime(),
        releasedBy: '周敏',
        cards: JSON.parse(JSON.stringify(state.cards)),
        signatures: JSON.parse(JSON.stringify(state.signatures)),
        personnel: JSON.parse(JSON.stringify(state.personnel))
      };
      state.audit.unshift({ time: nowTime(), actor: '周敏', action: '锁定放行', detail: `工作包 R${state.serverVersion} 已锁定，形成放行基线快照（工卡 ${state.baseline.cards.length} · 签字 ${state.baseline.signatures.length} · 人员资质 ${state.baseline.personnel.length} 随档封存）` });
    }
  }
});

export const {
  selectCard,
  updateCard,
  setConflict,
  refreshVersion,
  toggleOffline,
  authorizeOverride,
  signStage,
  resolveReviewCandidate,
  revokeQualification,
  transferPerson,
  handoffShift,
  backfillSignatures,
  retryPendingWrite,
  releasePackage
} = slice.actions;

export const store = createAppStore();

export function createAppStore(preloadedState?: MaintenanceState) {
  return configureStore({
    reducer: { maintenance: slice.reducer, [maintenanceApi.reducerPath]: maintenanceApi.reducer },
    middleware: (getDefault) => getDefault().concat(maintenanceApi.middleware),
    preloadedState: preloadedState ? ({ maintenance: preloadedState } as never) : undefined
  });
}

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('yy61-work-package-v2', JSON.stringify(store.getState().maintenance));
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
