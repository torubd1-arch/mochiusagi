// js/profiles.js - マルチユーザー(プロフィール)管理
// 同じ端末・同じブラウザを家族で共有していても、ユーザーごとに
// きろく(進捗)が混ざらないようにするための仕組み。
// storage.js / readingStorage.js / kanjiSelectStorage.js は、それぞれの
// localStorageキーの末尾に「今えらばれているプロフィールID」を付けて
// 保存する(Profiles.keyFor(baseKey))。

const Profiles = (() => {
  const KEY = 'kanjiBattle_profiles_v1';
  // プロフィール導入前に使われていた素のキー。初回のみ、最初のプロフィールへ
  // 中身をそのままコピーして引き継ぐ(既存の記録を消さないため)。
  const LEGACY_BASE_KEYS = ['kanjiBattle_v1', 'kanjiBattle_reading_v1', 'kanjiBattle_kanjiSelect_v1'];

  function makeId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.profiles)) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {}
  }

  // 初回起動時: プロフィールが1件も無ければ作成する。このとき、
  // プロフィール導入前の保存データが残っていれば、その内容を新しい
  // プロフィール専用キーへコピーする(一度きりの移行、既存データは消さない)。
  function ensureInitialized() {
    let data = load();
    if (data && data.profiles.length > 0 && data.activeProfileId) return data;

    const id = makeId();
    data = { profiles: [{ id, name: 'プレイヤー1' }], activeProfileId: id };

    LEGACY_BASE_KEYS.forEach(baseKey => {
      try {
        const existing = localStorage.getItem(baseKey);
        if (existing !== null) {
          localStorage.setItem(`${baseKey}__${id}`, existing);
        }
      } catch (e) {}
    });

    save(data);
    return data;
  }

  return {
    getProfiles() {
      return ensureInitialized().profiles;
    },
    getActiveProfileId() {
      return ensureInitialized().activeProfileId;
    },
    getActiveProfile() {
      const data = ensureInitialized();
      return data.profiles.find(p => p.id === data.activeProfileId) || data.profiles[0];
    },
    setActiveProfileId(id) {
      const data = ensureInitialized();
      if (!data.profiles.find(p => p.id === id)) return false;
      data.activeProfileId = id;
      save(data);
      return true;
    },
    // name: 表示名(前後の空白を除去し、10文字までに切り詰める)
    addProfile(name) {
      const data = ensureInitialized();
      const trimmed = String(name || '').trim().slice(0, 10);
      if (!trimmed) return null;
      const id = makeId();
      data.profiles.push({ id, name: trimmed });
      data.activeProfileId = id;
      save(data);
      return id;
    },
    // 2件以上あるときだけ削除できる(最低1件は残す)。関連する各Storageの
    // データ(プロフィール専用キー)も一緒に削除する。
    deleteProfile(id) {
      const data = ensureInitialized();
      if (data.profiles.length <= 1) return false;
      const idx = data.profiles.findIndex(p => p.id === id);
      if (idx === -1) return false;
      data.profiles.splice(idx, 1);
      if (data.activeProfileId === id) {
        data.activeProfileId = data.profiles[0].id;
      }
      save(data);
      LEGACY_BASE_KEYS.forEach(baseKey => {
        try { localStorage.removeItem(`${baseKey}__${id}`); } catch (e) {}
      });
      return true;
    },
    // baseKey (例:'kanjiBattle_v1') に、今アクティブなプロフィールIDを
    // 付加した実際のlocalStorageキーを返す。
    keyFor(baseKey) {
      return `${baseKey}__${this.getActiveProfileId()}`;
    },
  };
})();
