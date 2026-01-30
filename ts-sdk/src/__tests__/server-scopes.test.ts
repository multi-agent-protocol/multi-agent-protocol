/**
 * Tests for server ScopeManager and InMemoryScopeStore
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InMemoryScopeStore,
  ScopeManagerImpl,
  ScopeNotFoundError,
  InvalidParentScopeError,
  ScopeHasChildrenError,
  SCOPE_HIERARCHY_DEFAULTS,
  type ServerScope,
} from "../server/scopes";
import { EventBusImpl } from "../server/events";

describe("InMemoryScopeStore", () => {
  let store: InMemoryScopeStore;

  beforeEach(() => {
    store = new InMemoryScopeStore();
  });

  const createScope = (overrides: Partial<ServerScope> = {}): ServerScope => ({
    id: "scope-1",
    name: "Test Scope",
    metadata: {},
    createdAt: Date.now(),
    ...overrides,
  });

  describe("saveScope and getScope", () => {
    it("should store and retrieve a scope", () => {
      const scope = createScope();
      store.saveScope(scope);

      expect(store.getScope(scope.id)).toEqual(scope);
    });

    it("should return undefined for unknown ID", () => {
      expect(store.getScope("unknown")).toBeUndefined();
    });
  });

  describe("listScopes", () => {
    beforeEach(() => {
      // Create hierarchy: root -> child1, child2 -> grandchild
      store.saveScope(createScope({ id: "root", name: "Root" }));
      store.saveScope(createScope({ id: "child1", name: "Child 1", parentId: "root" }));
      store.saveScope(createScope({ id: "child2", name: "Child 2", parentId: "root" }));
      store.saveScope(createScope({ id: "grandchild", name: "Grandchild", parentId: "child1" }));
    });

    it("should return all scopes with no filter", () => {
      expect(store.listScopes()).toHaveLength(4);
    });

    it("should filter by parentId", () => {
      const children = store.listScopes({ parentId: "root" });
      expect(children).toHaveLength(2);
      expect(children.map((s) => s.id).sort()).toEqual(["child1", "child2"]);
    });

    it("should filter root scopes with parentId: null", () => {
      const roots = store.listScopes({ parentId: null });
      expect(roots).toHaveLength(1);
      expect(roots[0].id).toBe("root");
    });

    it("should filter by ancestorId", () => {
      const descendants = store.listScopes({ ancestorId: "root" });
      expect(descendants).toHaveLength(3);
    });
  });

  describe("hierarchy", () => {
    beforeEach(() => {
      store.saveScope(createScope({ id: "root", name: "Root" }));
      store.saveScope(createScope({ id: "child1", name: "Child 1", parentId: "root" }));
      store.saveScope(createScope({ id: "child2", name: "Child 2", parentId: "root" }));
      store.saveScope(createScope({ id: "grandchild", name: "Grandchild", parentId: "child1" }));
    });

    it("should get ancestors", () => {
      const ancestors = store.getAncestors("grandchild");
      expect(ancestors).toEqual(["child1", "root"]);
    });

    it("should return empty for root scope ancestors", () => {
      expect(store.getAncestors("root")).toEqual([]);
    });

    it("should get descendants", () => {
      const descendants = store.getDescendants("root");
      expect(descendants.sort()).toEqual(["child1", "child2", "grandchild"]);
    });

    it("should return empty for leaf scope descendants", () => {
      expect(store.getDescendants("grandchild")).toEqual([]);
    });
  });

  describe("membership", () => {
    beforeEach(() => {
      store.saveScope(createScope({ id: "scope1" }));
      store.saveScope(createScope({ id: "scope2", parentId: "scope1" }));
    });

    it("should add and get members", () => {
      store.addMember("scope1", "agent1");
      store.addMember("scope1", "agent2");

      expect(store.getMembers("scope1")).toEqual(["agent1", "agent2"]);
    });

    it("should not duplicate members", () => {
      store.addMember("scope1", "agent1");
      store.addMember("scope1", "agent1");

      expect(store.getMembers("scope1")).toEqual(["agent1"]);
    });

    it("should remove members", () => {
      store.addMember("scope1", "agent1");
      store.addMember("scope1", "agent2");
      store.removeMember("scope1", "agent1");

      expect(store.getMembers("scope1")).toEqual(["agent2"]);
    });

    it("should get members including descendants", () => {
      store.addMember("scope1", "agent1");
      store.addMember("scope2", "agent2");

      const members = store.getMembers("scope1", true);
      expect(members.sort()).toEqual(["agent1", "agent2"]);
    });

    it("should get scopes for agent", () => {
      store.addMember("scope1", "agent1");
      store.addMember("scope2", "agent1");

      expect(store.getScopesForAgent("agent1").sort()).toEqual(["scope1", "scope2"]);
    });
  });

  describe("deleteScope", () => {
    it("should clean up membership on delete", () => {
      store.saveScope(createScope({ id: "scope1" }));
      store.addMember("scope1", "agent1");

      store.deleteScope("scope1");

      expect(store.getScopesForAgent("agent1")).toEqual([]);
    });
  });
});

describe("ScopeManagerImpl", () => {
  let eventBus: EventBusImpl;
  let manager: ScopeManagerImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    manager = new ScopeManagerImpl({ eventBus });
  });

  describe("create", () => {
    it("should create scope with ULID", () => {
      const scope = manager.create({ name: "Test Scope" });

      expect(scope.id).toBeDefined();
      expect(scope.id.length).toBe(26);
      expect(scope.name).toBe("Test Scope");
    });

    it("should set optional fields", () => {
      const scope = manager.create({
        name: "Test Scope",
        metadata: { key: "value" },
        createdBy: "agent-1",
      });

      expect(scope.metadata).toEqual({ key: "value" });
      expect(scope.createdBy).toBe("agent-1");
    });

    it("should emit scope.created event", () => {
      const handler = vi.fn();
      eventBus.on("scope.created", handler);

      const scope = manager.create({ name: "Test" });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "scope.created",
          data: { scope },
        })
      );
    });

    it("should create child scope with valid parent", () => {
      const parent = manager.create({ name: "Parent" });
      const child = manager.create({ name: "Child", parentId: parent.id });

      expect(child.parentId).toBe(parent.id);
    });

    it("should throw for invalid parent", () => {
      expect(() =>
        manager.create({ name: "Child", parentId: "nonexistent" })
      ).toThrow(InvalidParentScopeError);
    });
  });

  describe("hierarchy navigation", () => {
    let root: ServerScope;
    let child1: ServerScope;
    let child2: ServerScope;
    let grandchild: ServerScope;

    beforeEach(() => {
      root = manager.create({ name: "Root" });
      child1 = manager.create({ name: "Child 1", parentId: root.id });
      child2 = manager.create({ name: "Child 2", parentId: root.id });
      grandchild = manager.create({ name: "Grandchild", parentId: child1.id });
    });

    it("should get parent", () => {
      expect(manager.getParent(child1.id)?.id).toBe(root.id);
      expect(manager.getParent(root.id)).toBeUndefined();
    });

    it("should get children", () => {
      const children = manager.getChildren(root.id);
      expect(children.map((s) => s.id).sort()).toEqual([child1.id, child2.id].sort());
    });

    it("should get ancestors", () => {
      const ancestors = manager.getAncestors(grandchild.id);
      expect(ancestors.map((s) => s.id)).toEqual([child1.id, root.id]);
    });

    it("should get descendants", () => {
      const descendants = manager.getDescendants(root.id);
      expect(descendants.map((s) => s.id).sort()).toEqual(
        [child1.id, child2.id, grandchild.id].sort()
      );
    });
  });

  describe("delete", () => {
    it("should delete scope", () => {
      const scope = manager.create({ name: "Test" });

      expect(manager.delete(scope.id)).toBe(true);
      expect(manager.get(scope.id)).toBeUndefined();
    });

    it("should emit scope.deleted event", () => {
      const handler = vi.fn();
      eventBus.on("scope.deleted", handler);

      const scope = manager.create({ name: "Test" });
      manager.delete(scope.id);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "scope.deleted",
          data: { scopeId: scope.id },
        })
      );
    });

    it("should delete descendants when requested", () => {
      const parent = manager.create({ name: "Parent" });
      const child = manager.create({ name: "Child", parentId: parent.id });

      manager.delete(parent.id, { deleteDescendants: true });

      expect(manager.get(parent.id)).toBeUndefined();
      expect(manager.get(child.id)).toBeUndefined();
    });

    it("should include deleted descendants in event", () => {
      const handler = vi.fn();
      eventBus.on("scope.deleted", handler);

      const parent = manager.create({ name: "Parent" });
      const child = manager.create({ name: "Child", parentId: parent.id });

      manager.delete(parent.id, { deleteDescendants: true });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deletedDescendants: [child.id],
          }),
        })
      );
    });

    it("should return false for unknown scope", () => {
      expect(manager.delete("unknown")).toBe(false);
    });

    it("should throw ScopeHasChildrenError when deleting scope with children", () => {
      const parent = manager.create({ name: "Parent" });
      manager.create({ name: "Child", parentId: parent.id });

      expect(() => manager.delete(parent.id)).toThrow(ScopeHasChildrenError);
      expect(() => manager.delete(parent.id)).toThrow(/has 1 child scope/);
    });

    it("should orphan children when orphanChildren is true", () => {
      const parent = manager.create({ name: "Parent" });
      const child = manager.create({ name: "Child", parentId: parent.id });

      manager.delete(parent.id, { orphanChildren: true });

      expect(manager.get(parent.id)).toBeUndefined();
      // Child should still exist but with no parent
      const orphanedChild = manager.get(child.id);
      expect(orphanedChild).toBeDefined();
      expect(orphanedChild?.parentId).toBeUndefined();
    });

    it("should allow deleting leaf scope without options", () => {
      const parent = manager.create({ name: "Parent" });
      const child = manager.create({ name: "Child", parentId: parent.id });

      // Child has no children, should delete fine
      expect(manager.delete(child.id)).toBe(true);
      expect(manager.get(child.id)).toBeUndefined();
    });
  });

  describe("SCOPE_HIERARCHY_DEFAULTS", () => {
    it("should have correct delete defaults", () => {
      expect(SCOPE_HIERARCHY_DEFAULTS.delete.withChildren).toBe("error");
      expect(SCOPE_HIERARCHY_DEFAULTS.delete.options).toContain("error");
      expect(SCOPE_HIERARCHY_DEFAULTS.delete.options).toContain("deleteDescendants");
      expect(SCOPE_HIERARCHY_DEFAULTS.delete.options).toContain("orphanChildren");
    });

    it("should have correct membership defaults", () => {
      expect(SCOPE_HIERARCHY_DEFAULTS.getMembers.includeDescendants).toBe(false);
      expect(SCOPE_HIERARCHY_DEFAULTS.isMember.checkAncestors).toBe(false);
      expect(SCOPE_HIERARCHY_DEFAULTS.membership.cascadesDown).toBe(false);
      expect(SCOPE_HIERARCHY_DEFAULTS.membership.cascadesUp).toBe(false);
    });
  });

  describe("membership", () => {
    let scope: ServerScope;

    beforeEach(() => {
      scope = manager.create({ name: "Test" });
    });

    it("should join agent to scope", () => {
      manager.join(scope.id, "agent-1");

      expect(manager.getMembers(scope.id)).toContain("agent-1");
    });

    it("should emit scope.agent.joined event", () => {
      const handler = vi.fn();
      eventBus.on("scope.agent.joined", handler);

      manager.join(scope.id, "agent-1");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "scope.agent.joined",
          data: { scopeId: scope.id, agentId: "agent-1" },
        })
      );
    });

    it("should throw when joining nonexistent scope", () => {
      expect(() => manager.join("unknown", "agent-1")).toThrow(ScopeNotFoundError);
    });

    it("should leave scope", () => {
      manager.join(scope.id, "agent-1");
      manager.leave(scope.id, "agent-1");

      expect(manager.getMembers(scope.id)).not.toContain("agent-1");
    });

    it("should emit scope.agent.left event", () => {
      const handler = vi.fn();
      eventBus.on("scope.agent.left", handler);

      manager.join(scope.id, "agent-1");
      manager.leave(scope.id, "agent-1");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "scope.agent.left",
          data: { scopeId: scope.id, agentId: "agent-1" },
        })
      );
    });

    it("should get members including descendants", () => {
      const child = manager.create({ name: "Child", parentId: scope.id });

      manager.join(scope.id, "agent-1");
      manager.join(child.id, "agent-2");

      const members = manager.getMembers(scope.id, { includeDescendants: true });
      expect(members.sort()).toEqual(["agent-1", "agent-2"]);
    });

    it("should get scopes for agent", () => {
      const scope2 = manager.create({ name: "Scope 2" });

      manager.join(scope.id, "agent-1");
      manager.join(scope2.id, "agent-1");

      const scopes = manager.getScopesForAgent("agent-1");
      expect(scopes.sort()).toEqual([scope.id, scope2.id].sort());
    });

    it("should check direct membership", () => {
      manager.join(scope.id, "agent-1");

      expect(manager.isMember(scope.id, "agent-1")).toBe(true);
      expect(manager.isMember(scope.id, "agent-2")).toBe(false);
    });

    it("should check ancestor membership", () => {
      const child = manager.create({ name: "Child", parentId: scope.id });

      manager.join(scope.id, "agent-1"); // In parent only

      expect(manager.isMember(child.id, "agent-1")).toBe(false);
      expect(manager.isMember(child.id, "agent-1", { checkAncestors: true })).toBe(true);
    });

    it("should leave all scopes", () => {
      const scope2 = manager.create({ name: "Scope 2" });

      manager.join(scope.id, "agent-1");
      manager.join(scope2.id, "agent-1");

      const left = manager.leaveAll("agent-1");

      expect(left.sort()).toEqual([scope.id, scope2.id].sort());
      expect(manager.getScopesForAgent("agent-1")).toEqual([]);
    });

    it("should emit events for leaveAll", () => {
      const handler = vi.fn();
      eventBus.on("scope.agent.left", handler);

      manager.join(scope.id, "agent-1");
      manager.leaveAll("agent-1");

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
