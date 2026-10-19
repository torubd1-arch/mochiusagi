// 対戦設定画面の入力状態（下書き）の操作。純粋関数として新しい下書きを返す。
import { MAX_TEAMS, MIN_TEAMS, MAX_MEMBERS, MIN_MEMBERS } from './logic.js';

function newMember(idGen) {
  return { id: idGen(), name: '' };
}

function newTeam(idGen) {
  return { id: idGen(), name: '', members: [newMember(idGen)] };
}

export function createDraft(idGen) {
  return { name: '', teams: [newTeam(idGen), newTeam(idGen)] };
}

export function canAddTeam(draft) {
  return draft.teams.length < MAX_TEAMS;
}

export function canRemoveTeam(draft) {
  return draft.teams.length > MIN_TEAMS;
}

export function addTeam(draft, idGen) {
  if (!canAddTeam(draft)) return draft;
  return { ...draft, teams: [...draft.teams, newTeam(idGen)] };
}

export function removeTeam(draft, teamId) {
  if (!canRemoveTeam(draft)) return draft;
  return { ...draft, teams: draft.teams.filter((t) => t.id !== teamId) };
}

export function canAddMember(team) {
  return team.members.length < MAX_MEMBERS;
}

/** 1人目は削除不可、最少人数を下回らない */
export function canRemoveMember(team, memberIndex) {
  return memberIndex > 0 && team.members.length > MIN_MEMBERS;
}

export function addMember(draft, teamId, idGen) {
  return {
    ...draft,
    teams: draft.teams.map((t) =>
      t.id === teamId && canAddMember(t) ? { ...t, members: [...t.members, newMember(idGen)] } : t,
    ),
  };
}

export function removeMember(draft, teamId, memberId) {
  return {
    ...draft,
    teams: draft.teams.map((t) => {
      if (t.id !== teamId) return t;
      const idx = t.members.findIndex((m) => m.id === memberId);
      if (idx < 0 || !canRemoveMember(t, idx)) return t;
      return { ...t, members: t.members.filter((m) => m.id !== memberId) };
    }),
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 対戦名が空のときの既定名「日時＋モルック対戦」 */
export function defaultSessionName(date) {
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} モルック対戦`;
}
