import type { ActingRelation, Personnel, Shift, SignatureRow } from './domain';

// 演示场景时间锚点：2026-10-05 定检，早班交班后进入中班
export const CURRENT_SHIFT = '中班';

export const seedPersonnel: Personnel[] = [
  {
    id: 'P01', name: '赵明', role: '机械师', shift: '早班', active: true,
    qualifications: [
      { scope: '机械', certNo: 'CQ-ME-0108', validFrom: '2025-04-01', validUntil: '2027-03-31', active: true }
    ]
  },
  {
    id: 'P02', name: '宋杰', role: '机械员', shift: '早班', active: true,
    qualifications: [
      { scope: '机械', certNo: 'CQ-ME-0214', validFrom: '2024-09-01', validUntil: '2026-09-30', active: true }
    ]
  },
  {
    id: 'P03', name: '林岚', role: '系统工程师', shift: '中班', active: true,
    qualifications: [
      { scope: '系统', certNo: 'CQ-SY-0331', validFrom: '2025-01-01', validUntil: '2026-12-31', active: true }
    ]
  },
  {
    id: 'P04', name: '周正', role: '质量检验员', shift: '中班', active: true,
    qualifications: [
      { scope: '系统', certNo: 'CQ-QC-0426', validFrom: '2024-06-01', validUntil: '2027-05-31', active: true },
      { scope: '放行', certNo: 'CQ-RL-0427', validFrom: '2024-06-01', validUntil: '2027-05-31', active: true }
    ]
  },
  {
    id: 'P05', name: '陈骁', role: '动力工程师', shift: '中班', active: true,
    qualifications: [
      { scope: '动力', certNo: 'CQ-PW-0512', validFrom: '2025-08-01', validUntil: '2026-08-31', active: true }
    ]
  },
  {
    id: 'P06', name: '韩松', role: '动力工程师', shift: '夜班', active: true,
    qualifications: [
      { scope: '动力', certNo: 'CQ-PW-0603', validFrom: '2025-02-01', validUntil: '2027-01-31', active: true }
    ]
  },
  {
    id: 'P07', name: '吴敏', role: '质量经理', shift: '中班', active: true,
    qualifications: [
      { scope: '放行', certNo: 'CQ-RL-0709', validFrom: '2023-01-01', validUntil: '2027-12-31', active: true }
    ]
  },
  {
    id: 'P08', name: '孙磊', role: '机械师', shift: '中班', active: true,
    qualifications: [
      { scope: '机械', certNo: 'CQ-ME-0811', validFrom: '2025-06-01', validUntil: '2027-05-31', active: true }
    ]
  }
];

export const seedShifts: Shift[] = [
  {
    name: '早班',
    roster: [
      { personId: 'P01', scope: '机械' },
      { personId: 'P02', scope: '机械' },
      { personId: 'P03', scope: '系统' }
    ]
  },
  {
    name: '中班',
    roster: [
      { personId: 'P03', scope: '系统' },
      { personId: 'P04', scope: '系统' },
      { personId: 'P05', scope: '动力' },
      { personId: 'P08', scope: '机械' },
      { personId: 'P07', scope: '放行' }
    ]
  },
  {
    name: '夜班',
    roster: [
      { personId: 'P06', scope: '动力' }
    ]
  }
];

export const seedRelations: ActingRelation[] = [
  // 韩松（夜班）持代班关系覆盖中班动力阶段
  { id: 'ACT-09', substituteId: 'P06', shift: '中班', scope: '动力', validFrom: '2026-10-05', validUntil: '2026-10-06', active: true }
];

// 旧签字：交班后完成的机械阶段签字仍挂在已下班人员名下
export const legacyRows: SignatureRow[] = [
  {
    id: 'SIG-L01', eventId: 'EVT-5001', stage: '机械', role: '执行',
    personId: 'P01', personName: '赵明', scope: '机械',
    shift: '早班', time: '2026-10-05 08:40', seq: 1,
    status: '有效', legacy: true
  },
  {
    // 旧系统未登记人员工号映射，按班次名册无法回填 → 留待换签
    id: 'SIG-L02', eventId: 'EVT-5002', stage: '机械', role: '执行',
    personId: 'P99', personName: '钱坤（旧系统工号缺失）', scope: '机械',
    shift: '早班', time: '2026-10-05 07:55', seq: 2,
    status: '有效', legacy: true
  }
];
