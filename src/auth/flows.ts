import type { AppDispatch, RootState } from '../store';
import { maintenanceApi, releaseSlot } from '../api';
import {
  deactivateActing,
  markLegacySuperseded,
  rejectSignature,
  revokeQualification,
  saveDraft,
  signatureAccepted,
  signaturePending,
  signatureWriteFailed,
  transferPerson
} from '../store';
import { resolveSignatureAuth, type SignRole, type StageId } from './domain';

export type SignOutcome = 'accepted' | 'duplicate' | 'pending' | 'write-failed' | 'rejected';
export type SignResult = { ok: boolean; outcome: SignOutcome };

// 签字提交流程：
// 1. 授权链本地判定（资质有效期 / 班次名册 / 代班 / 质量阶段职责分离）
// 2. 通过则登记草稿（写入失败时草稿+事件号保留，恢复后同事件号重试不多签）
// 3. 服务端按「阶段+角色」槽位仲裁：先到生效，后到保留待复核
export const requestSignature = (stage: StageId, role: SignRole, personIdArg?: string) => async (
  dispatch: AppDispatch,
  getState: () => RootState
): Promise<SignResult> => {
  const state = getState().maintenance;
  const personId = personIdArg ?? state.currentUserId;
  if (state.released) {
    dispatch(rejectSignature({ stage, role, personId, reason: '工作包已放行锁定，签字以放行基线快照为准' }));
    return { ok: false, outcome: 'rejected' };
  }
  const auth = resolveSignatureAuth({
    stage, role, personId,
    personnel: state.personnel,
    shifts: state.shifts,
    currentShiftName: state.currentShift,
    relations: state.relations,
    signatures: state.signatures,
    cards: state.cards
  });
  if (!auth.ok || !auth.certNo) {
    dispatch(rejectSignature({ stage, role, personId, reason: auth.reason }));
    return { ok: false, outcome: 'rejected' };
  }

  // 复用失败保留的原草稿与事件号；没有才登记新草稿
  const existing = state.drafts.find((d) => d.stage === stage && d.role === role && d.personId === personId);
  if (!existing) {
    dispatch(saveDraft({
      stage, role, personId,
      certNo: auth.certNo,
      validUntil: auth.validUntil ?? '',
      actingId: auth.actingId,
      reason: auth.reason
    }));
  }
  const draft = getState().maintenance.drafts.find((d) => d.stage === stage && d.role === role && d.personId === personId);
  if (!draft) return { ok: false, outcome: 'write-failed' };
  return dispatch(runWrite(draft.eventId, stage, role, personId));
};

const runWrite = (eventId: string, stage: StageId, role: SignRole, personId: string) => async (
  dispatch: AppDispatch,
  getState: () => RootState
): Promise<SignResult> => {
  const certNo = getState().maintenance.personnel.find((p) => p.id === personId)
    ?.qualifications.find((q) => q.scope === stage && q.active)?.certNo;
  const actingId = getState().maintenance.relations.find(
    (r) => r.substituteId === personId && r.scope === stage && r.active
  )?.id;
  try {
    const result = await dispatch(maintenanceApi.endpoints.submitSignature.initiate({
      eventId, stage, role, personId, certNo, actingId
    })).unwrap();
    if (result.duplicate && getState().maintenance.signatures.some((r) => r.eventId === eventId)) {
      // 幂等重放：服务端确认同一事件号，本地签字已在，绝不产生第二张
      return { ok: true, outcome: 'duplicate' };
    }
    dispatch(signatureAccepted({
      eventId, stage, role, personId,
      serverSeq: result.serverSeq,
      duplicate: result.duplicate
    }));
    return { ok: true, outcome: result.duplicate ? 'duplicate' : 'accepted' };
  } catch (error: unknown) {
    const e = error as { status?: number; data?: { message?: string } };
    if (e?.status === 409) {
      dispatch(signaturePending({
        eventId, stage, role, personId,
        reason: e.data?.message ?? '该阶段已有先生效签字'
      }));
      return { ok: false, outcome: 'pending' };
    }
    // 写入失败：保留原草稿与事件号
    dispatch(signatureWriteFailed({ eventId }));
    return { ok: false, outcome: 'write-failed' };
  }
};

// 授权范围变化后，释放失去所有有效签字的「阶段+角色」服务端槽位，使重新签署可被先到仲裁
const releaseEmptiedSlots = (getState: () => RootState) => {
  const { signatures } = getState().maintenance;
  (['机械', '系统', '动力', '放行'] as StageId[]).forEach((stage) => {
    (['执行', '复核'] as SignRole[]).forEach((role) => {
      const hasEffective = signatures.some((r) => r.stage === stage && r.role === role && r.status === '有效');
      if (!hasEffective) releaseSlot(stage, role);
    });
  });
};

export const revokeQualFlow = (personId: string, scope: StageId) => async (
  dispatch: AppDispatch, getState: () => RootState
) => {
  dispatch(revokeQualification({ personId, scope }));
  releaseEmptiedSlots(getState);
};

export const transferFlow = (personId: string, toShift: string) => async (
  dispatch: AppDispatch, getState: () => RootState
) => {
  dispatch(transferPerson({ personId, toShift }));
  releaseEmptiedSlots(getState);
};

export const deactivateActingFlow = (id: string) => async (
  dispatch: AppDispatch, getState: () => RootState
) => {
  dispatch(deactivateActing(id));
  releaseEmptiedSlots(getState);
};

// 旧签字换签：旧行置失效 → 释放槽位 → 按当前授权链重新签字
export const resignFlow = (rowId: string, personIdArg?: string) => async (
  dispatch: AppDispatch, getState: () => RootState
) => {
  const row = getState().maintenance.signatures.find((r) => r.id === rowId);
  if (!row) return { ok: false, outcome: 'rejected' as const };
  const personId = personIdArg ?? getState().maintenance.currentUserId;
  dispatch(markLegacySuperseded(rowId));
  releaseSlot(row.stage, row.role);
  return dispatch(requestSignature(row.stage, row.role, personId));
};
