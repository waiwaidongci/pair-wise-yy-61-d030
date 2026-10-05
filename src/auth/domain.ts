// 授权链领域模型：工卡 → 阶段签字 → 人员资质/代班 → 放行基线
// 所有判定均为纯函数，store 只负责编排与持久化。

export const TODAY = '2026-10-05';

export type StageId = '机械' | '系统' | '动力' | '放行';
export type SignRole = '执行' | '复核';
export type SigStatus = '有效' | '待复核' | '失效' | '待换签';

export type Qualification = {
  scope: StageId;
  certNo: string;
  validFrom: string;
  validUntil: string;
  active: boolean; // 撤回后为 false
};

export type Personnel = {
  id: string;
  name: string;
  role: string;
  shift: string; // 当前所属班次（换岗后更新）
  active: boolean; // 在职/在岗
  qualifications: Qualification[];
};

export type ActingRelation = {
  id: string;
  substituteId: string; // 代班人
  shift: string;
  scope: StageId;
  validFrom: string;
  validUntil: string;
  active: boolean;
};

export type Shift = {
  name: string;
  roster: { personId: string; scope: StageId }[];
};

export type SignatureRow = {
  id: string;
  eventId: string;
  stage: StageId;
  role: SignRole;
  personId: string;
  personName: string;
  certNo?: string; // 旧签字可能没有资质号
  scope: StageId;
  qualValidUntil?: string; // 签字时登记的资质有效期
  actingId?: string; // 凭代班关系签字时登记
  shift: string;
  time: string;
  seq: number;
  status: SigStatus;
  pendingReason?: string;
  invalidReason?: string;
  legacy?: boolean;
  backfilled?: boolean;
};

export type SignatureDraft = {
  eventId: string;
  stage: StageId;
  role: SignRole;
  personId: string;
  time: string;
  reason: string;
  attempts: number;
};

export type StageMeta = {
  id: StageId;
  cardIds: string[];
  quality: boolean; // 质量阶段：执行与复核不得同一人
  requiredRoles: SignRole[];
};

export const STAGES: StageMeta[] = [
  { id: '机械', cardIds: ['CARD-01'], quality: false, requiredRoles: ['执行'] },
  { id: '系统', cardIds: ['CARD-03'], quality: true, requiredRoles: ['执行', '复核'] },
  { id: '动力', cardIds: ['CARD-07'], quality: false, requiredRoles: ['执行'] },
  { id: '放行', cardIds: ['CARD-08'], quality: true, requiredRoles: ['执行', '复核'] }
];

export const stageMeta = (stage: StageId): StageMeta => STAGES.find((item) => item.id === stage)!;

// ---------- 资质 / 代班判定 ----------

export function validQualification(person: Personnel | undefined, scope: StageId, on = TODAY): Qualification | undefined {
  if (!person || !person.active) return undefined;
  return person.qualifications.find((q) => q.scope === scope && q.active && q.validFrom <= on && on <= q.validUntil);
}

export function validActing(relations: ActingRelation[], personId: string, shift: string, scope: StageId, on = TODAY): ActingRelation | undefined {
  return relations.find(
    (r) => r.active && r.substituteId === personId && r.shift === shift && r.scope === scope && r.validFrom <= on && on <= r.validUntil
  );
}

// 当班签字人：本班名册成员，或持有覆盖本班有效代班关系的人员
export function isOnShift(person: Personnel, shift: Shift, acting: ActingRelation | undefined): boolean {
  if (shift.roster.some((r) => r.personId === person.id)) return true;
  return Boolean(acting);
}

// ---------- 签字授权解析（授权链核心） ----------

export type AuthInput = {
  stage: StageId;
  role: SignRole;
  personId: string;
  personnel: Personnel[];
  shifts: Shift[];
  currentShiftName: string;
  relations: ActingRelation[];
  signatures: SignatureRow[];
  cards: { id: string; status: string; executorId?: string }[];
};

export type AuthResult = {
  ok: boolean;
  reason: string;
  certNo?: string;
  validUntil?: string;
  actingId?: string;
  shift: string;
};

export function resolveSignatureAuth(input: AuthInput, on = TODAY): AuthResult {
  const meta = stageMeta(input.stage);
  const person = input.personnel.find((p) => p.id === input.personId);
  const currentShift = input.shifts.find((s) => s.name === input.currentShiftName);
  if (!person) return { ok: false, reason: '签字人员不存在', shift: input.currentShiftName };
  if (!person.active) return { ok: false, reason: `${person.name} 已离岗/换岗，无签字权限`, shift: input.currentShiftName };
  if (!currentShift) return { ok: false, reason: '当前班次不存在', shift: input.currentShiftName };

  const qual = validQualification(person, input.stage, on);
  const acting = validActing(input.relations, person.id, currentShift.name, input.stage, on);
  if (!qual) {
    return acting
      ? { ok: false, reason: `${person.name} 的 ${input.stage} 资质已撤回或过期，代班关系不能替代资质`, shift: currentShift.name }
      : { ok: false, reason: `${person.name} 无有效的 ${input.stage} 阶段资质（撤回或已过期）`, shift: currentShift.name };
  }
  if (!isOnShift(person, currentShift, acting)) {
    return { ok: false, reason: `${person.name} 不在 ${currentShift.name} 名册，且无覆盖本班的代班关系`, shift: currentShift.name };
  }

  // 质量阶段：同一人不能既执行又复核
  const stageCard = input.cards.find((c) => meta.cardIds.includes(c.id));
  if (meta.quality) {
    if (input.role === '复核') {
      const executor = effectiveRow(input.signatures, input.stage, '执行');
      if ((executor && executor.personId === person.id) || stageCard?.executorId === person.id) {
        return { ok: false, reason: '质量阶段职责分离：复核人不能与执行/施工人为同一人', shift: currentShift.name };
      }
    } else {
      const reviewer = effectiveRow(input.signatures, input.stage, '复核');
      if (reviewer && reviewer.personId === person.id) {
        return { ok: false, reason: '质量阶段职责分离：同一人不能既复核又执行', shift: currentShift.name };
      }
    }
  }

  return {
    ok: true,
    reason: acting ? `凭代班关系 ${acting.id} 在 ${currentShift.name} 签字` : `${currentShift.name} 名册授权签字`,
    certNo: qual.certNo,
    validUntil: qual.validUntil,
    actingId: acting?.id,
    shift: currentShift.name
  };
}

// ---------- 生效签字选择 ----------

export function effectiveRow(rows: SignatureRow[], stage: StageId, role: SignRole): SignatureRow | undefined {
  return rows
    .filter((r) => r.stage === stage && r.role === role && r.status === '有效')
    .sort((a, b) => b.seq - a.seq)[0];
}

export function isStageComplete(rows: SignatureRow[], stage: StageId): boolean {
  return stageMeta(stage).requiredRoles.every((role) => Boolean(effectiveRow(rows, stage, role)));
}

export const pendingRows = (rows: SignatureRow[]) => rows.filter((r) => r.status === '待复核');

// ---------- 授权范围变化：未放行签字立即失效回到待签 ----------

export function invalidateByScope(
  rows: SignatureRow[],
  predicate: (r: SignatureRow) => boolean,
  reason: string
): SignatureRow[] {
  return rows.map((r) =>
    r.status === '有效' && predicate(r)
      ? { ...r, status: '失效', invalidReason: reason }
      : r
  );
}

// ---------- 旧签字回填：无资质号按班次名册反查 ----------

export type BackfillResult = {
  row: SignatureRow;
  outcome: '回填成功' | '回填不通过';
  detail: string;
  matched?: Personnel;
  cert?: Qualification;
};

export function backfillLegacy(
  row: SignatureRow,
  personnel: Personnel[],
  shifts: Shift[],
  on = TODAY
): BackfillResult {
  if (row.certNo) return { row, outcome: '回填成功', detail: '签字已登记资质号，无需回填' };
  const shift = shifts.find((s) => s.name === row.shift);
  const rosterEntry = shift?.roster.find((r) => r.personId === row.personId && r.scope === row.scope);
  if (!shift || !rosterEntry) {
    return {
      row: { ...row, status: '待换签', invalidReason: `班次名册中查无此人/此授权（${row.shift} · ${row.scope}）` },
      outcome: '回填不通过',
      detail: `${row.shift} 名册未匹配到 ${row.personName} 的 ${row.scope} 授权，留待换签`
    };
  }
  const person = personnel.find((p) => p.id === rosterEntry.personId);
  const qualAtSign = person?.qualifications.find(
    (q) => q.scope === row.scope && q.active && q.validFrom <= row.time.slice(0, 10) && row.time.slice(0, 10) <= q.validUntil
  );
  if (!person || !qualAtSign) {
    return {
      row: { ...row, status: '待换签', invalidReason: '名册匹配到人员但无签字当日有效的资质' },
      outcome: '回填不通过',
      detail: `${person?.name ?? row.personName} 在 ${row.time.slice(0, 10)} 无有效 ${row.scope} 资质，留待换签`,
      matched: person
    };
  }
  return {
    row: {
      ...row,
      certNo: qualAtSign.certNo,
      qualValidUntil: qualAtSign.validUntil,
      backfilled: true,
      status: '有效',
      invalidReason: undefined
    },
    outcome: '回填成功',
    detail: `按 ${row.shift} 名册回填 ${person.name} 资质 ${qualAtSign.certNo}（有效期至 ${qualAtSign.validUntil}）`,
    matched: person,
    cert: qualAtSign
  };
}

// ---------- 放行基线 ----------

export type ReleaseBaseline = {
  time: string;
  revision: number;
  snapshot: SignatureRow[]; // 当时有效签字的只读快照
  gates: { label: string; pass: boolean; detail: string }[];
};

export function evaluateReleaseGates(
  rows: SignatureRow[],
  cards: { id: string; status: string }[]
): ReleaseBaseline['gates'] {
  const completedRequired = STAGES.flatMap((s) => s.cardIds).every((id) => cards.find((c) => c.id === id)?.status === '已完成');
  return [
    {
      label: '授权链四个阶段签字均有效',
      pass: STAGES.every((s) => isStageComplete(rows, s.id)),
      detail: STAGES.map((s) => `${s.id}${isStageComplete(rows, s.id) ? '✓' : '✗'}`).join(' ')
    },
    {
      label: '无待复核/待换签/失效签字',
      pass: rows.every((r) => r.status === '有效'),
      detail: `待复核 ${pendingRows(rows).length} · 待换签 ${rows.filter((r) => r.status === '待换签').length} · 失效 ${rows.filter((r) => r.status === '失效').length}`
    },
    {
      label: '关键工卡全部完成',
      pass: completedRequired,
      detail: STAGES.flatMap((s) => s.cardIds).join('、')
    },
    {
      label: '无待授权超差项目',
      pass: !cards.some((c) => c.status === '待授权'),
      detail: cards.some((c) => c.status === '待授权') ? '存在待授权工卡' : '超差项目均已闭环'
    }
  ];
}

export function buildBaseline(
  rows: SignatureRow[],
  cards: { id: string; status: string }[],
  revision: number,
  time: string
): ReleaseBaseline {
  return {
    time,
    revision,
    snapshot: rows.filter((r) => r.status === '有效').map((r) => ({ ...r })),
    gates: evaluateReleaseGates(rows, cards)
  };
}
