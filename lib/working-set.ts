// Guards the in-memory working set (lib/data.ts arrays and the ERP store).
//
// The working set holds ONE tenant's data at a time, loaded at the start of that tenant's database
// transaction. Outside a transaction it may already belong to another tenant's request, so any read there
// is a cross-tenant leak waiting to happen. lib/db/database.ts registers the check; every property read
// and write on a guarded object calls it and throws when it fails.

type GuardRegistry = typeof globalThis & { __pharmWorkingSetGuard?: () => boolean };

export class WorkingSetAccessError extends Error {
  constructor() {
    super("ERP data was used outside a pharmacy transaction. Read it inside requirePage(), pageData(), guarded() or withDatabaseTransaction().");
    this.name = "WorkingSetAccessError";
  }
}

export function assertWorkingSetAccess() {
  const check = (globalThis as GuardRegistry).__pharmWorkingSetGuard;
  if (check && !check()) throw new WorkingSetAccessError();
}

const proxies = new WeakMap<object, object>();

/** A view of target that checks the guard on every read and write. Same view for the same target. */
export function guardWorkingSet<T extends object>(target: T): T {
  const existing = proxies.get(target);
  if (existing) return existing as T;
  const proxy = new Proxy(target, {
    get(object, property, receiver) {
      assertWorkingSetAccess();
      return Reflect.get(object, property, receiver);
    },
    set(object, property, value, receiver) {
      assertWorkingSetAccess();
      return Reflect.set(object, property, value, receiver);
    },
    has(object, property) {
      assertWorkingSetAccess();
      return Reflect.has(object, property);
    },
    ownKeys(object) {
      assertWorkingSetAccess();
      return Reflect.ownKeys(object);
    },
  });
  proxies.set(target, proxy);
  return proxy;
}
