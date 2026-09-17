/* global jest */
// Native storage has no JS implementation under jest. These doubles keep the
// one property the tests depend on — two SEPARATE stores — and expose their
// contents (`__store`) so a test can assert which store a value went to.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    __store: store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, value),
    deleteItemAsync: async (key) => void store.delete(key),
  };
});
