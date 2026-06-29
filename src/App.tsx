import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FlipHorizontal,
  LogOut,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sun,
  UserCheck,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { api, session } from "./api";
import type { Branch, CreateRemarkPayload, RegisterPayload, ReportNotification, Remark, RemarkCalendarEvent, RemarkStatus, RoleCode, User, UserInfo } from "./types";

const statuses: Array<RemarkStatus | ""> = ["", "NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const roleOptions: RoleCode[] = ["APPLICANT", "MASTER", "BRANCH_HEAD"];
type View = "remarks" | "calendar" | "summary" | "notifications" | "employees";
type EmployeeTab = "pending" | "employees";
type Theme = "light" | "dark";

const statusLabel: Record<RemarkStatus, string> = {
  NEW: "Новое",
  ASSIGNED: "Назначено",
  IN_PROGRESS: "В работе",
  RESOLVED: "Устранено",
  CLOSED: "Закрыто",
};

const roleLabel: Record<RoleCode, string> = {
  APPLICANT: "Заявитель",
  MASTER: "Организация, ответственная за устранение",
  BRANCH_HEAD: "Ответственный",
  ADMIN: "Администратор",
};

const statusClass: Record<RemarkStatus, string> = {
  NEW: "new",
  ASSIGNED: "assigned",
  IN_PROGRESS: "progress",
  RESOLVED: "resolved",
  CLOSED: "closed",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU").format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatEstimatedResolution(remark: Remark) {
  if (remark.resolvedAt) {
    return { title: formatDateTime(remark.resolvedAt), subtitle: "" };
  }
  if (remark.status === "CLOSED") {
    return { title: formatDateTime(remark.closedAt), subtitle: "" };
  }
  if (!remark.estimatedResolutionAt) {
    return { title: "Не указано", subtitle: "" };
  }

  return {
    title: `до ${formatDateTime(remark.estimatedResolutionAt)}`,
    subtitle: "",
  };
}
function toDateTimeLocalValue(value?: string | null) {
  if (!value) return "";
  return value.slice(0, 16);
}

function currentDateTimeLocalValue() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Minsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

function readReportsKey(userId: string) {
  return `remark.readReports.${userId}`;
}

function readStoredReadReportIds(userId: string) {
  const raw = localStorage.getItem(readReportsKey(userId));
  if (!raw) return new Set<string>();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set<string>();
  }
}

function storeReadReportIds(userId: string, ids: Set<string>) {
  localStorage.setItem(readReportsKey(userId), JSON.stringify(Array.from(ids)));
}

function userSettingsKey(userId: string, key: string) {
  return `remark.${userId}.${key}`;
}

function readTheme(userId?: string): Theme {
  if (!userId) return "light";
  return (localStorage.getItem(userSettingsKey(userId, "theme")) as Theme | null) ?? "light";
}

function readInverted(userId?: string) {
  if (!userId) return false;
  return localStorage.getItem(userSettingsKey(userId, "inverted")) === "true";
}

function readSidebarWidth(userId?: string) {
  if (!userId) return 280;
  const stored = Number(localStorage.getItem(userSettingsKey(userId, "sidebarWidth")));
  return Number.isFinite(stored) && stored >= 240 && stored <= 520 ? stored : 280;
}

function hasRole(user: UserInfo | null, roles: RoleCode[]) {
  return Boolean(user?.roles.some((role) => roles.includes(role)));
}

function branchName(branches: Branch[], id?: string | null) {
  const branch = branches.find((item) => item.id === id);
  return branch ? `${branch.code} · ${branch.name}` : "—";
}

function userName(usersById: Record<string, User | UserInfo>, id?: string | null) {
  if (!id) return "—";
  return usersById[id]?.fullName ?? id;
}

function userEmail(usersById: Record<string, User | UserInfo>, id?: string | null) {
  if (!id) return "";
  return usersById[id]?.email ?? "";
}

function calendarColorIndex(id: string) {
  return Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 8;
}

export function App() {
  const [user, setUser] = useState<UserInfo | null>(session.user);
  const [activeView, setActiveView] = useState<View>("remarks");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [managedUsers, setManagedUsers] = useState<User[]>([]);
  const [reports, setReports] = useState<ReportNotification[]>([]);
  const [readReportIds, setReadReportIds] = useState<Set<string>>(() => new Set());
  const [employeeTab, setEmployeeTab] = useState<EmployeeTab>("pending");
  const [masters, setMasters] = useState<User[]>([]);
  const [usersById, setUsersById] = useState<Record<string, User | UserInfo>>({});
  const [statusFilter, setStatusFilter] = useState<RemarkStatus | "">("");
  const [branchFilter, setBranchFilter] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [theme, setTheme] = useState<Theme>(() => readTheme(session.user?.userId));
  const [inverted, setInverted] = useState(() => readInverted(session.user?.userId));
  const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth(session.user?.userId));

  const selectedRemark = useMemo(
    () => remarks.find((remark) => remark.id === selectedId) ?? null,
    [remarks, selectedId],
  );

  const visibleRemarks = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return remarks;
    return remarks.filter((remark) =>
      [remark.remarkNumber, remark.objectBuilding, remark.description, statusLabel[remark.status]]
        .join(" ")
        .toLowerCase()
        .includes(text),
    );
  }, [query, remarks]);

  const ownBranchRemarks = useMemo(
    () => visibleRemarks.filter((remark) => remark.branchId === user?.branchId),
    [visibleRemarks, user?.branchId],
  );

  const detailRemark = useMemo(() => {
    if (!selectedRemark) return null;
    if (hasRole(user, ["ADMIN", "BRANCH_HEAD"])) {
      const canAssignOrganization =
        selectedRemark.branchId === user?.branchId &&
        selectedRemark.status === "NEW" &&
        !selectedRemark.assignedMasterId &&
        !selectedRemark.resolvedAt &&
        !selectedRemark.closedAt &&
        !selectedRemark.reportSentAt;
      return canAssignOrganization ? selectedRemark : null;
    }
    return selectedRemark;
  }, [selectedRemark, user]);

  const unreadReportCount = useMemo(
    () => reports.filter((report) => !readReportIds.has(report.id)).length,
    [readReportIds, reports],
  );

  useEffect(() => {
    void loadBranches(false);
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem(userSettingsKey(user.userId, "theme"), theme);
    }
  }, [theme, user?.userId]);

  useEffect(() => {
    if (user) {
      localStorage.setItem(userSettingsKey(user.userId, "inverted"), String(inverted));
    }
  }, [inverted, user?.userId]);

  useEffect(() => {
    if (user) {
      localStorage.setItem(userSettingsKey(user.userId, "sidebarWidth"), String(sidebarWidth));
    }
  }, [sidebarWidth, user?.userId]);

  function startSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const direction = inverted ? -1 : 1;

    function move(moveEvent: PointerEvent) {
      const nextWidth = Math.min(520, Math.max(240, startWidth + (moveEvent.clientX - startX) * direction));
      setSidebarWidth(nextWidth);
    }

    function stop() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("resizing-sidebar");
    }

    document.body.classList.add("resizing-sidebar");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  useEffect(() => {
    if (user) {
      setSelectedId(null);
      setMasters([]);
      setPendingUsers([]);
      setManagedUsers([]);
      setReports([]);
      setUsersById({});
      setStatusFilter("");
      setBranchFilter("");
      setTheme(readTheme(user.userId));
      setInverted(readInverted(user.userId));
      setSidebarWidth(readSidebarWidth(user.userId));
      cacheUsers([user]);
      setReadReportIds(readStoredReadReportIds(user.userId));
      void refreshWorkplace();
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      void refreshWorkplace();
    }
  }, [statusFilter, branchFilter, activeView]);

  useEffect(() => {
    if (!user || hasRole(user, ["ADMIN", "BRANCH_HEAD"])) return;
    setActiveView("remarks");
  }, [user]);

  function cacheUsers(users: Array<User | UserInfo>) {
    setUsersById((current) => {
      const next = { ...current };
      users.forEach((item) => {
        const id = "id" in item ? item.id : item.userId;
        next[id] = item;
      });
      return next;
    });
  }

  async function loadBranches(showErrors = true) {
    setBranchesLoading(true);
    try {
      const loadedBranches = await api.branches();
      setBranches(loadedBranches);
      if (showErrors && loadedBranches.length === 0) {
        setMessage("Справочник филиалов пуст. Проверьте, что reference-service запущен и Liquibase seed-branches применен.");
      }
    } catch (error) {
      if (showErrors) {
        setMessage(error instanceof Error ? error.message : "Не удалось загрузить филиалы");
      }
    } finally {
      setBranchesLoading(false);
    }
  }

  async function refreshWorkplace() {
    setLoading(true);
    setMessage("");
    try {
      const branchId = hasRole(user, ["ADMIN", "BRANCH_HEAD"]) && activeView === "summary" ? branchFilter || undefined : undefined;
      const data = await api.remarks(statusFilter || undefined, branchId);
      const preferredRemark = hasRole(user, ["ADMIN", "BRANCH_HEAD"])
        ? data.find((item) => item.branchId === user?.branchId) ?? data[0]
        : data[0];
      setRemarks(data);
      setSelectedId(preferredRemark?.id ?? null);
      void loadRemarkUsers(data);
      if (hasRole(user, ["ADMIN", "BRANCH_HEAD"])) {
        const loadedPendingUsers = await api.pendingUsers();
        setPendingUsers(loadedPendingUsers);
        cacheUsers(loadedPendingUsers);
        const loadedManagedUsers = await api.managedUsers();
        setManagedUsers(loadedManagedUsers);
        cacheUsers(loadedManagedUsers);
      }
      if (hasRole(user, ["ADMIN", "BRANCH_HEAD", "APPLICANT"])) {
        setReports(await api.reports());
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось обновить журнал");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await api.logout();
    setUser(null);
    setRemarks([]);
    setPendingUsers([]);
    setManagedUsers([]);
    setReports([]);
    setReadReportIds(new Set());
    setMasters([]);
    setUsersById({});
    setActiveView("remarks");
  }

  function replaceRemark(updated: Remark) {
    setRemarks((items) => {
      const exists = items.some((item) => item.id === updated.id);
      return exists ? items.map((item) => (item.id === updated.id ? updated : item)) : [updated, ...items];
    });
    setSelectedId(updated.id);
  }

  async function ensureUserLoaded(id?: string | null) {
    if (!id || usersById[id]) return;
    try {
      cacheUsers([await api.user(id)]);
    } catch {
      // The id fallback remains visible if the user is unavailable to the current actor.
    }
  }

  async function loadRemarkUsers(items: Remark[]) {
    const ids = Array.from(
      new Set(
        items
          .flatMap((item) => [item.createdByUserId, item.assignedMasterId])
          .filter((id): id is string => typeof id === "string" && !usersById[id]),
      ),
    );
    const loaded = await Promise.all(
      ids.map(async (id) => {
        try {
          return await api.user(id);
        } catch {
          return null;
        }
      }),
    );
    cacheUsers(loaded.filter((item): item is User => Boolean(item)));
  }

  if (!user) {
    return (
      <AuthScreen
        branches={branches}
        mode={authMode}
        message={message}
        branchesLoading={branchesLoading}
        onModeChange={setAuthMode}
        onMessage={setMessage}
        onReloadBranches={() => loadBranches(true)}
        onLogin={setUser}
      />
    );
  }

  return (
    <div
      className={`app-shell theme-${theme}${inverted ? " inverted" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            <ClipboardList size={28} />
            <div>
              <strong>Журнал замечаний</strong>
              <span>Производственный контур</span>
            </div>
          </div>
        </div>

        <div className="profile">
          <span className="avatar">{user.fullName.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.fullName}</strong>
            <span>{user.roles.map((role) => roleLabel[role]).join(", ")}</span>
          </div>
        </div>

        <nav className="side-nav">
          <button className={activeView === "remarks" ? "active" : ""} type="button" onClick={() => setActiveView("remarks")}>
            <ClipboardList size={18} /> Замечания
          </button>
          {hasRole(user, ["MASTER"]) && (
            <button className={activeView === "calendar" ? "active" : ""} type="button" onClick={() => setActiveView("calendar")}>
              <CalendarDays size={18} /> Календарь
            </button>
          )}
          {hasRole(user, ["ADMIN", "BRANCH_HEAD"]) && (
            <button className={activeView === "summary" ? "active" : ""} type="button" onClick={() => setActiveView("summary")}>
              <BarChart3 size={18} /> Сводная таблица
            </button>
          )}
          {hasRole(user, ["ADMIN", "BRANCH_HEAD", "APPLICANT"]) && (
            <button className={activeView === "notifications" ? "active" : ""} type="button" onClick={() => setActiveView("notifications")}>
              <Bell size={18} /> Оповещения
              <span>{unreadReportCount}</span>
            </button>
          )}
          {hasRole(user, ["ADMIN", "BRANCH_HEAD"]) && (
            <button className={activeView === "employees" ? "active" : ""} type="button" onClick={() => setActiveView("employees")}>
              <Users size={18} /> Управление сотрудниками
              <span>{pendingUsers.length}</span>
            </button>
          )}
        </nav>

        <div className="branch-card">
          <span>Филиал</span>
          <strong>{branchName(branches, user.branchId)}</strong>
        </div>

        <button className="ghost-button" type="button" onClick={handleLogout}>
          <LogOut size={18} /> Выйти
        </button>
        <button
          className="sidebar-resizer"
          type="button"
          onPointerDown={startSidebarResize}
          aria-label="Изменить ширину панели"
          title="Потяните, чтобы изменить ширину панели"
        />
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>Оперативный журнал</h1>
            <p>Фиксация дефектов, назначение ответственных организаций и контроль закрытия.</p>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
              title={theme === "light" ? "Темная тема" : "Светлая тема"}
            >
              {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => setInverted((value) => !value)}
              title="Инвертировать интерфейс"
            >
              <FlipHorizontal size={19} />
            </button>
            <button className="icon-button" type="button" onClick={refreshWorkplace} title="Обновить">
              <RefreshCw size={19} className={loading ? "spin" : ""} />
            </button>
          </div>
        </header>

        {message && (
          <div className="notice">
            <AlertTriangle size={18} />
            <span>{message}</span>
            <button type="button" onClick={() => setMessage("")} title="Закрыть">
              <X size={16} />
            </button>
          </div>
        )}

        {activeView === "calendar" && hasRole(user, ["MASTER"]) ? (
          <RepairCalendarView
            remarks={remarks}
            onOpenRemark={(remarkId) => {
              setSelectedId(remarkId);
              setActiveView("remarks");
            }}
            onError={setMessage}
          />
        ) : activeView === "notifications" && hasRole(user, ["ADMIN", "BRANCH_HEAD"]) ? (
          <ReportsView
            reports={reports}
            readReportIds={readReportIds}
            currentUser={user}
            onRead={setReadReportIds}
            onError={setMessage}
          />
        ) : activeView === "employees" && hasRole(user, ["ADMIN", "BRANCH_HEAD"]) ? (
          <EmployeeManagementView
            pendingUsers={pendingUsers}
            managedUsers={managedUsers}
            branches={branches}
            currentUser={user}
            activeTab={employeeTab}
            onTabChange={setEmployeeTab}
            onChanged={async () => {
              const loadedPendingUsers = await api.pendingUsers();
              setPendingUsers(loadedPendingUsers);
              cacheUsers(loadedPendingUsers);
              const loadedManagedUsers = await api.managedUsers();
              setManagedUsers(loadedManagedUsers);
              cacheUsers(loadedManagedUsers);
            }}
            onError={setMessage}
          />
        ) : activeView === "summary" && hasRole(user, ["ADMIN", "BRANCH_HEAD"]) ? (
          <section className="summary-view">
            <div className="journal-panel">
              <div className="toolbar">
                <div className="search">
                  <Search size={18} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по номеру, объекту, описанию" />
                </div>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RemarkStatus | "")}>
                  {statuses.map((status) => (
                    <option key={status || "all"} value={status}>
                      {status ? statusLabel[status] : "Все статусы"}
                    </option>
                  ))}
                </select>
                <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
                  <option value="">Все филиалы</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.code} В· {branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="table-section">
                <h2>Сводная таблица</h2>
                <RemarkTable
                  remarks={visibleRemarks}
                  branches={branches}
                  usersById={usersById}
                  selectedId={selectedRemark?.id}
                  onSelect={setSelectedId}
                />
              </div>
            </div>
          </section>
        ) : (
          <>
        <section className="content-grid">
          <div className="journal-panel own-journal-panel">
            <div className="toolbar">
              <div className="search">
                <Search size={18} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по номеру, объекту, описанию" />
              </div>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RemarkStatus | "")}>
                {statuses.map((status) => (
                  <option key={status || "all"} value={status}>
                    {status ? statusLabel[status] : "Все статусы"}
                  </option>
                ))}
              </select>
              {false && hasRole(user, ["ADMIN", "BRANCH_HEAD"]) && (
                <select
                  value={branchFilter}
                  onChange={(event) => setBranchFilter(event.target.value)}
                >
                  <option value="">Все филиалы</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.code} · {branch.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {hasRole(user, ["ADMIN", "BRANCH_HEAD"]) && (
              <div className="table-section">
                <h2>Записи филиала</h2>
                <RemarkTable
                  remarks={ownBranchRemarks}
                  branches={branches}
                  usersById={usersById}
                  selectedId={selectedRemark?.id}
                  onSelect={setSelectedId}
                />
              </div>
            )}

            <div className="table-section">
              <h2>{hasRole(user, ["ADMIN", "BRANCH_HEAD"]) ? "Сводный журнал" : "Замечания"}</h2>
              <RemarkTable
                remarks={visibleRemarks}
                branches={branches}
                usersById={usersById}
                selectedId={selectedRemark?.id}
                onSelect={(id) => {
                  const remark = visibleRemarks.find((item) => item.id === id);
                  if (hasRole(user, ["ADMIN", "BRANCH_HEAD"]) && remark?.branchId !== user.branchId) {
                    setSelectedId(null);
                    setMessage("Замечание другого филиала доступно только в сводной таблице без назначения ответственной организации.");
                    return;
                  }
                  setSelectedId(id);
                }}
              />
            </div>
          </div>

          <div className="detail-stack">
            {hasRole(user, ["ADMIN", "BRANCH_HEAD", "APPLICANT"]) && (
              <CreateRemarkForm
                onCreated={(remark) => {
                  replaceRemark(remark);
                  void refreshWorkplace();
                }}
                onError={setMessage}
              />
            )}

            <RemarkDetails
              user={user}
              remark={detailRemark}
              branches={branches}
              masters={masters}
              usersById={usersById}
              onUpdated={replaceRemark}
              onNeedMasters={async (branchId) => {
                const loadedMasters = await api.usersByRole(branchId, "MASTER");
                setMasters(loadedMasters);
                cacheUsers(loadedMasters);
              }}
              onNeedUser={ensureUserLoaded}
              onError={setMessage}
            />
          </div>
        </section>
          </>
        )}
      </main>
    </div>
  );
}

function AuthScreen({
  branches,
  branchesLoading,
  mode,
  message,
  onModeChange,
  onMessage,
  onReloadBranches,
  onLogin,
}: {
  branches: Branch[];
  branchesLoading: boolean;
  mode: "login" | "register";
  message: string;
  onModeChange: (mode: "login" | "register") => void;
  onMessage: (message: string) => void;
  onReloadBranches: () => Promise<void>;
  onLogin: (user: UserInfo) => void;
}) {
  return (
    <div className="auth-layout">
      <section className="auth-info">
        <div className="brand auth-brand">
          <ClipboardList size={30} />
          <div>
            <strong>Журнал замечаний</strong>
            <span>Учет дефектов и поломок</span>
          </div>
        </div>
        <h1>Единое рабочее место для контроля производственных замечаний</h1>
        <div className="auth-stats">
          <span>NEW</span>
          <span>ASSIGNED</span>
          <span>IN_PROGRESS</span>
          <span>RESOLVED</span>
          <span>CLOSED</span>
        </div>
      </section>

      <section className="auth-card">
        <div className="tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => onModeChange("login")} type="button">
            Вход
          </button>
          <button className={mode === "register" ? "active" : ""} onClick={() => onModeChange("register")} type="button">
            Регистрация
          </button>
        </div>
        {message && <div className="form-message">{message}</div>}
        {mode === "login" ? (
          <LoginForm onLogin={onLogin} onError={onMessage} />
        ) : (
          <RegisterForm
            branches={branches}
            branchesLoading={branchesLoading}
            onReloadBranches={onReloadBranches}
            onDone={() => onModeChange("login")}
            onMessage={onMessage}
          />
        )}
      </section>
    </div>
  );
}

function LoginForm({ onLogin, onError }: { onLogin: (user: UserInfo) => void; onError: (message: string) => void }) {
  const [email, setEmail] = useState("admin-1212@remark.local");
  const [password, setPassword] = useState("Admin123!");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    onError("");
    try {
      const response = await api.login(email, password);
      onLogin(response.user);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Email
        <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
      </label>
      <label>
        Пароль
        <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
      </label>
      <button className="primary-button" disabled={busy} type="submit">
        <ShieldCheck size={18} /> Войти
      </button>
    </form>
  );
}

function RegisterForm({
  branches,
  branchesLoading,
  onReloadBranches,
  onDone,
  onMessage,
}: {
  branches: Branch[];
  branchesLoading: boolean;
  onReloadBranches: () => Promise<void>;
  onDone: () => void;
  onMessage: (message: string) => void;
}) {
  const [form, setForm] = useState<RegisterPayload>({
    email: "",
    password: "",
    fullName: "",
    position: "",
    branchId: branches[0]?.id ?? "",
    requestedRole: "APPLICANT",
  });

  useEffect(() => {
    if ((!form.branchId || !branches.some((branch) => branch.id === form.branchId)) && branches[0]?.id) {
      setForm((value) => ({ ...value, branchId: branches[0].id }));
    }
  }, [branches, form.branchId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.branchId) {
      onMessage("Выберите филиал. Если список пустой, обновите справочник филиалов.");
      return;
    }
    try {
      await api.register(form);
      onMessage("Заявка создана. Дождитесь подтверждения администратора или ответственного.");
      onDone();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Не удалось зарегистрироваться");
    }
  }

  const branchesUnavailable = branchesLoading || branches.length === 0;

  return (
    <form className="form" onSubmit={submit}>
      <label>
        ФИО
        <input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required />
      </label>
      <label>
        Должность
        <input value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value })} required />
      </label>
      <label>
        Email
        <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} type="email" required />
      </label>
      <label>
        Пароль
        <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" minLength={8} required />
      </label>
      <label>
        Филиал
        <select
          value={form.branchId}
          onChange={(event) => setForm({ ...form, branchId: event.target.value })}
          disabled={branchesUnavailable}
          required
        >
          <option value="">
            {branchesLoading ? "Загрузка филиалов..." : branches.length ? "Выберите филиал" : "Филиалы не загружены"}
          </option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.code} · {branch.name}
            </option>
          ))}
        </select>
      </label>
      {branches.length === 0 && (
        <div className="form-hint">
          <span>Список должен прийти из `/api/v1/refs/branches` после применения `changelog-seed-branches.xml`.</span>
          <button className="secondary-button" type="button" onClick={onReloadBranches} disabled={branchesLoading}>
            <RefreshCw size={16} className={branchesLoading ? "spin" : ""} /> Обновить филиалы
          </button>
        </div>
      )}
      <label>
        Роль
        <select value={form.requestedRole} onChange={(event) => setForm({ ...form, requestedRole: event.target.value as RoleCode })}>
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {roleLabel[role]}
            </option>
          ))}
        </select>
      </label>
      <button className="primary-button" type="submit" disabled={branchesUnavailable}>
        <Send size={18} /> Отправить заявку
      </button>
    </form>
  );
}

function RemarkTable({
  remarks,
  branches,
  usersById,
  selectedId,
  onSelect,
}: {
  remarks: Remark[];
  branches: Branch[];
  usersById: Record<string, User | UserInfo>;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Номер</th>
            <th>Объект</th>
            <th>Филиал</th>
            <th>Кто сообщил</th>
            <th>Обнаружено</th>
            <th>Дата устранения</th>
            <th>Организация, ответственная за устранение</th>
            <th>Отчет об устранении</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {remarks.map((remark) => (
            <tr key={remark.id} className={selectedId === remark.id ? "selected" : ""} onClick={() => onSelect(remark.id)}>
              <td>{remark.remarkNumber}</td>
              <td>
                <strong>{remark.objectBuilding}</strong>
                <span>{remark.description}</span>
              </td>
              <td>{branchName(branches, remark.branchId)}</td>
              <td>
                <strong>{userName(usersById, remark.createdByUserId)}</strong>
                {userEmail(usersById, remark.createdByUserId) && <span>{userEmail(usersById, remark.createdByUserId)}</span>}
              </td>
              <td>{formatDate(remark.discoveredAt)}</td>
              <td>
                {(() => {
                  const estimated = formatEstimatedResolution(remark);
                  return (
                    <>
                      <strong>{estimated.title}</strong>
                      {estimated.subtitle && <span>{estimated.subtitle}</span>}
                    </>
                  );
                })()}
              </td>
              <td>{remark.assignedMasterId ? userName(usersById, remark.assignedMasterId) : "Не назначена"}</td>
              <td>
                <label className="report-check">
                  <input type="checkbox" checked={Boolean(remark.reportSentAt)} readOnly />
                  <span>{remark.reportSentAt ? "Отправлен" : "Не отправлен"}</span>
                </label>
              </td>
              <td>
                <StatusBadge status={remark.status} />
              </td>
            </tr>
          ))}
          {!remarks.length && (
            <tr>
              <td colSpan={9} className="empty-cell">
                Записей нет
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: RemarkStatus }) {
  return <span className={`status ${statusClass[status]}`}>{statusLabel[status]}</span>;
}

function CreateRemarkForm({ onCreated, onError }: { onCreated: (remark: Remark) => void; onError: (message: string) => void }) {
  const [form, setForm] = useState<CreateRemarkPayload>({
    objectBuilding: "",
    description: "",
    discoveredAt: today(),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const remark = await api.createRemark(form);
      onCreated(remark);
      setForm({ objectBuilding: "", description: "", discoveredAt: today() });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось создать замечание");
    }
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Новое замечание</h2>
        <Plus size={18} />
      </div>
      <form className="form compact" onSubmit={submit}>
        <label>
          Объект, здание, участок
          <input value={form.objectBuilding} onChange={(event) => setForm({ ...form, objectBuilding: event.target.value })} maxLength={500} required />
        </label>
        <label>
          Дата обнаружения
          <input value={form.discoveredAt} onChange={(event) => setForm({ ...form, discoveredAt: event.target.value })} type="date" required />
        </label>
        <label>
          Описание дефекта
          <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} required />
        </label>
        <button className="primary-button" type="submit">
          <Plus size={18} /> Создать
        </button>
      </form>
    </section>
  );
}

function RemarkDetails({
  user,
  remark,
  branches,
  masters,
  usersById,
  onUpdated,
  onNeedMasters,
  onNeedUser,
  onError,
}: {
  user: UserInfo;
  remark: Remark | null;
  branches: Branch[];
  masters: User[];
  usersById: Record<string, User | UserInfo>;
  onUpdated: (remark: Remark) => void;
  onNeedMasters: (branchId: string) => Promise<void>;
  onNeedUser: (id?: string | null) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [masterId, setMasterId] = useState("");
  const [resolution, setResolution] = useState("");
  const [estimatedResolutionAt, setEstimatedResolutionAt] = useState("");

  useEffect(() => {
    if (
      remark &&
      hasRole(user, ["ADMIN", "BRANCH_HEAD"]) &&
      remark.branchId === user.branchId &&
      remark.status === "NEW" &&
      !remark.assignedMasterId &&
      !remark.resolvedAt &&
      !remark.closedAt &&
      !remark.reportSentAt
    ) {
      setMasterId("");
      void onNeedMasters(remark.branchId);
    }
  }, [remark?.id]);

  useEffect(() => {
    void onNeedUser(remark?.assignedMasterId);
    void onNeedUser(remark?.createdByUserId);
  }, [remark?.assignedMasterId, remark?.createdByUserId]);

  useEffect(() => {
    setEstimatedResolutionAt(toDateTimeLocalValue(remark?.estimatedResolutionAt));
  }, [remark?.id, remark?.estimatedResolutionAt]);

  if (!remark) {
    return (
      <section className="panel">
        <div className="empty-state">
          {hasRole(user, ["ADMIN", "BRANCH_HEAD"])
            ? "Выберите активное неназначенное замечание своего филиала"
            : "Выберите замечание в журнале"}
        </div>
      </section>
    );
  }

  async function run(action: () => Promise<Remark>, fallback: string) {
    try {
      onUpdated(await action());
      setResolution("");
      setMasterId("");
    } catch (error) {
      onError(error instanceof Error ? error.message : fallback);
    }
  }

  const canManageRemark = hasRole(user, ["ADMIN", "BRANCH_HEAD"]) && remark.branchId === user.branchId;
  const canAssign =
    canManageRemark &&
    remark.status === "NEW" &&
    !remark.assignedMasterId &&
    !remark.resolvedAt &&
    !remark.closedAt &&
    !remark.reportSentAt;
  const canStart = hasRole(user, ["MASTER"]) && remark.status === "ASSIGNED" && remark.assignedMasterId === user.userId;
  const canResolve = hasRole(user, ["MASTER"]) && remark.status === "IN_PROGRESS" && remark.assignedMasterId === user.userId;
  const canSetEstimatedResolution =
    hasRole(user, ["MASTER"]) &&
    remark.assignedMasterId === user.userId &&
    (remark.status === "ASSIGNED" || remark.status === "IN_PROGRESS");
  const canClose = canManageRemark && remark.status === "RESOLVED";
  const hasActions = canAssign || canSetEstimatedResolution || canStart || canResolve || canClose;
  const assignedMaster = remark.assignedMasterId ? usersById[remark.assignedMasterId] : null;
  const reporter = usersById[remark.createdByUserId];
  const estimated = formatEstimatedResolution(remark);
  const branchMasters = masters.filter((master) => master.branchId === remark.branchId);

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h2>{remark.remarkNumber}</h2>
          <span>{branchName(branches, remark.branchId)}</span>
        </div>
        <StatusBadge status={remark.status} />
      </div>

      <dl className="details">
        <div>
          <dt>Объект</dt>
          <dd>{remark.objectBuilding}</dd>
        </div>
        <div>
          <dt>Описание</dt>
          <dd>{remark.description}</dd>
        </div>
        <div>
          <dt>Обнаружено</dt>
          <dd>{formatDate(remark.discoveredAt)}</dd>
        </div>
        <div>
          <dt>Создано</dt>
          <dd>{formatDateTime(remark.createdAt)}</dd>
        </div>
        <div>
          <dt>Кто сообщил</dt>
          <dd>{reporter?.fullName ?? remark.createdByUserId}</dd>
        </div>
        <div>
          <dt>Дата устранения</dt>
          <dd>
            {estimated.title}
            {estimated.subtitle ? ` (${estimated.subtitle})` : ""}
          </dd>
        </div>
        <div>
          <dt>Организация, ответственная за устранение</dt>
          <dd>{assignedMaster?.fullName ?? masters.find((master) => master.id === remark.assignedMasterId)?.fullName ?? remark.assignedMasterId ?? "Не назначена"}</dd>
        </div>
        <div>
          <dt>Отчет об устранении</dt>
          <dd>
            <label className="report-check">
              <input type="checkbox" checked={Boolean(remark.reportSentAt)} readOnly />
              <span>{remark.reportSentAt ? `Отправлен, ${formatDateTime(remark.reportSentAt)}` : "Не отправлен"}</span>
            </label>
          </dd>
        </div>
      </dl>

      {remark.resolutionMessage && (
        <div className="resolution">
          <strong>Результат устранения</strong>
          <p>{remark.resolutionMessage}</p>
        </div>
      )}

      {hasActions && <div className="actions">
        {canAssign && (
          <form
            className="inline-action"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => api.assignMaster(remark.id, masterId), "Не удалось назначить ответственную организацию");
            }}
          >
            <select value={masterId} onChange={(event) => setMasterId(event.target.value)} required>
              <option value="">Выберите организацию</option>
              {branchMasters.map((master) => (
                <option key={master.id} value={master.id}>
                  {master.fullName} · {master.position}
                </option>
              ))}
            </select>
            <button className="primary-button" type="submit">
              <UserCheck size={18} /> Назначить
            </button>
          </form>
        )}

        {canSetEstimatedResolution && (
          <form
            className="form compact"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () => api.setEstimatedResolution(remark.id, estimatedResolutionAt),
                "Не удалось сохранить примерную дату устранения",
              );
            }}
          >
            <label>
              Примерная дата устранения
              <input
                value={estimatedResolutionAt}
                onChange={(event) => setEstimatedResolutionAt(event.target.value)}
                type="datetime-local"
                min={currentDateTimeLocalValue()}
                required
              />
            </label>
            <button className="secondary-button" type="submit">
              <Check size={18} /> Сохранить срок
            </button>
          </form>
        )}

        {canStart && (
          <button
            className="primary-button"
            type="button"
            disabled={!remark.estimatedResolutionAt}
            onClick={() => {
              if (!remark.estimatedResolutionAt) {
                onError("Сначала укажите примерную дату устранения");
                return;
              }
              void run(() => api.startWork(remark.id), "Не удалось взять в работу");
            }}
          >
            <Play size={18} /> В работу
          </button>
        )}

        {canResolve && (
          <form
            className="form compact"
            onSubmit={(event) => {
              event.preventDefault();
              if (!remark.estimatedResolutionAt) {
                onError("Сначала укажите примерную дату устранения");
                return;
              }
              void run(() => api.resolve(remark.id, resolution), "Не удалось отметить устранение");
            }}
          >
            <label>
              Сообщение об устранении
              <textarea value={resolution} onChange={(event) => setResolution(event.target.value)} rows={3} required />
            </label>
            <button className="primary-button" type="submit">
              <Check size={18} /> Устранено
            </button>
          </form>
        )}

        {canClose && (
          <button className="primary-button" type="button" onClick={() => run(() => api.close(remark.id), "Не удалось закрыть замечание")}>
            <Check size={18} /> Закрыть
          </button>
        )}
      </div>}
    </section>
  );
}

function PendingUsers({
  title = "Заявки пользователей",
  users,
  branches,
  onChanged,
  onError,
}: {
  title?: string;
  users: User[];
  branches: Branch[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  async function decide(action: () => Promise<User>) {
    try {
      await action();
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось обработать заявку");
    }
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>{title}</h2>
        <span className="counter">{users.length}</span>
      </div>
      <div className="pending-list">
        {users.map((item) => (
          <article key={item.id} className="pending-item">
            <div>
              <strong>{item.fullName}</strong>
              <span>{item.email}</span>
              <small>
                {roleLabel[item.roles[0]] ?? "Роль"} · {branchName(branches, item.branchId)}
              </small>
            </div>
            <div className="decision-buttons">
              <button type="button" onClick={() => decide(() => api.approveUser(item.id))} title="Одобрить">
                <Check size={17} />
              </button>
              <button type="button" onClick={() => decide(() => api.rejectUser(item.id))} title="Отклонить">
                <X size={17} />
              </button>
            </div>
          </article>
        ))}
        {!users.length && <div className="empty-state small">Нет заявок на согласование</div>}
      </div>
    </section>
  );
}

function RepairCalendarView({
  remarks,
  onOpenRemark,
  onError,
}: {
  remarks: Remark[];
  onOpenRemark: (remarkId: string) => void;
  onError: (message: string) => void;
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [events, setEvents] = useState<RemarkCalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => dayKey(new Date()));
  const [selectedRemarkId, setSelectedRemarkId] = useState("");
  const [workStartTime, setWorkStartTime] = useState("09:00");
  const [workEndTime, setWorkEndTime] = useState("10:00");
  const [calendarVersion, setCalendarVersion] = useState(0);

  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(monthEnd.getDate() + ((7 - monthEnd.getDay()) % 7));
  const gridLength = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86_400_000);
  const gridDays = Array.from({ length: gridLength }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });

  useEffect(() => {
    let cancelled = false;
    async function loadCalendar() {
      setLoading(true);
      try {
        const loaded = await api.calendarEvents(toApiDateTime(monthStart), toApiDateTime(monthEnd));
        if (!cancelled) {
          setEvents(loaded);
        }
      } catch (error) {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : "Не удалось загрузить календарь");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadCalendar();
    return () => {
      cancelled = true;
    };
  }, [month.getFullYear(), month.getMonth(), calendarVersion]);

  function toApiDateTime(date: Date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  }

  function dayKey(date: Date) {
    return toApiDateTime(date).slice(0, 10);
  }

  function eventsForDay(dateKey: string) {
    return events.filter((event) => event.workDate === dateKey);
  }

  function isPastEvent(event: RemarkCalendarEvent) {
    return event.workDate < dayKey(new Date());
  }

  function moveMonth(delta: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function remarkCoversDate(remark: Remark, dateKey: string) {
    if (!remark.estimatedResolutionAt || !remark.assignedMasterId || remark.status === "RESOLVED" || remark.status === "CLOSED") {
      return false;
    }
    const createdDate = remark.createdAt.slice(0, 10);
    const estimatedDate = remark.estimatedResolutionAt.slice(0, 10);
    return createdDate <= dateKey && dateKey <= estimatedDate;
  }

  const selectedDateEvents = eventsForDay(selectedDate);
  const availableRemarks = remarks.filter((remark) => remarkCoversDate(remark, selectedDate));

  useEffect(() => {
    if (!selectedRemarkId && availableRemarks[0]) {
      setSelectedRemarkId(availableRemarks[0].id);
    }
  }, [selectedDate, availableRemarks.map((remark) => remark.id).join(",")]);

  async function saveCalendarEvent(event?: RemarkCalendarEvent) {
    const remarkId = event?.remarkId ?? selectedRemarkId;
    if (!remarkId) {
      onError("Выберите замечание для календаря");
      return;
    }
    const startTime = event ? event.workStartTime.slice(0, 5) : workStartTime;
    const endTime = event ? event.workEndTime.slice(0, 5) : workEndTime;
    try {
      await api.setCalendarEvent(remarkId, event?.workDate ?? selectedDate, startTime, endTime);
      setCalendarVersion((value) => value + 1);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось сохранить событие календаря");
    }
  }

  async function removeCalendarEvent(event: RemarkCalendarEvent) {
    try {
      await api.removeCalendarEvent(event.remarkId, event.workDate);
      setCalendarVersion((value) => value + 1);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось убрать событие календаря");
    }
  }

  return (
    <section className="calendar-layout">
      <section className="calendar-view">
        <div className="calendar-toolbar">
          <div>
            <h2>Календарь ремонтов</h2>
            <span>{new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(monthStart)}</span>
          </div>
          <div className="calendar-actions">
            <button className="icon-button" type="button" onClick={() => moveMonth(-1)} title="Предыдущий месяц">
              <ChevronLeft size={18} />
            </button>
            <button className="secondary-button" type="button" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
              Сегодня
            </button>
            <button className="icon-button" type="button" onClick={() => moveMonth(1)} title="Следующий месяц">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div className="calendar-weekdays">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {gridDays.map((day) => {
            const currentKey = dayKey(day);
            const dayEvents = eventsForDay(currentKey);
            const outside = day.getMonth() !== month.getMonth();
            const todayKey = dayKey(new Date());
            return (
              <div key={currentKey} className={`calendar-day${outside ? " outside" : ""}${currentKey === todayKey ? " today" : ""}${currentKey === selectedDate ? " selected" : ""}`} onClick={() => setSelectedDate(currentKey)}>
                <div className="calendar-date">{day.getDate()}</div>
                <div className="calendar-events">
                  {dayEvents.map((event) => (
                    <article key={`${event.remarkId}-${event.workDate}`} className={`calendar-event event-color-${calendarColorIndex(event.remarkId)}${isPastEvent(event) ? " past" : ""}`} onClick={(clickEvent) => clickEvent.stopPropagation()}>
                      <button type="button" className="calendar-event-open" onClick={() => onOpenRemark(event.remarkId)}>
                        <strong>{event.workStartTime.slice(0, 5)}-{event.workEndTime.slice(0, 5)}</strong>
                        <span>{event.remarkNumber}</span>
                        <small>{event.objectBuilding}</small>
                      </button>
                      <div className="calendar-event-controls">
                        <input aria-label="Начало работы" type="time" defaultValue={event.workStartTime.slice(0, 5)} onChange={(changeEvent) => { event.workStartTime = changeEvent.target.value; }} />
                        <input aria-label="Окончание работы" type="time" defaultValue={event.workEndTime.slice(0, 5)} onChange={(changeEvent) => { event.workEndTime = changeEvent.target.value; }} />
                        <button type="button" onClick={() => saveCalendarEvent(event)}>OK</button>
                        <button type="button" onClick={() => removeCalendarEvent(event)} title="Убрать карточку">X</button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {loading && <div className="empty-state small">Календарь загружается...</div>}
        {!loading && !events.length && <div className="empty-state small">На этот месяц сроков ремонта нет</div>}
      </section>

      <aside className="calendar-editor panel">
        <div className="panel-title">
          <div>
            <h2>План на день</h2>
            <span>{formatDate(selectedDate)}</span>
          </div>
          <span className="counter">{selectedDateEvents.length}</span>
        </div>
        <form className="form compact" onSubmit={(event) => { event.preventDefault(); void saveCalendarEvent(); }}>
          <label>
            Замечание
            <select value={selectedRemarkId} onChange={(event) => setSelectedRemarkId(event.target.value)} required>
              {availableRemarks.map((remark) => (
                <option key={remark.id} value={remark.id}>{remark.remarkNumber} · {remark.objectBuilding}</option>
              ))}
            </select>
          </label>
          <div className="calendar-time-row">
            <label>
              Начало
              <input type="time" value={workStartTime} onChange={(event) => setWorkStartTime(event.target.value)} required />
            </label>
            <label>
              Окончание
              <input type="time" value={workEndTime} onChange={(event) => setWorkEndTime(event.target.value)} required />
            </label>
          </div>
          <button className="secondary-button" type="submit" disabled={!availableRemarks.length}>Добавить карточку</button>
        </form>
      </aside>
    </section>
  );
}
function ReportsView({
  reports,
  readReportIds,
  currentUser,
  onRead,
  onError,
}: {
  reports: ReportNotification[];
  readReportIds: Set<string>;
  currentUser: UserInfo;
  onRead: (ids: Set<string>) => void;
  onError: (message: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);

  async function download(report: ReportNotification) {
    try {
      const { blob, fileName } = await api.downloadReport(report.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName || report.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось скачать отчет");
    }
  }

  async function toggleReport(report: ReportNotification) {
    const nextExpandedId = expandedId === report.id ? null : report.id;
    setExpandedId(nextExpandedId);

    if (nextExpandedId === report.id && !readReportIds.has(report.id)) {
      const nextReadIds = new Set(readReportIds);
      nextReadIds.add(report.id);
      storeReadReportIds(currentUser.userId, nextReadIds);
      onRead(nextReadIds);
    }

    if (nextExpandedId === report.id && !previewUrls[report.id]) {
      setLoadingPreviewId(report.id);
      try {
        const { blob } = await api.downloadReport(report.id);
        setPreviewUrls((current) => ({
          ...current,
          [report.id]: URL.createObjectURL(blob),
        }));
      } catch (error) {
        onError(error instanceof Error ? error.message : "Не удалось открыть отчет");
      } finally {
        setLoadingPreviewId(null);
      }
    }
  }

  const unreadCount = reports.filter((report) => !readReportIds.has(report.id)).length;

  return (
    <section className="approval-view">
      <section className="panel">
        <div className="panel-title">
          <h2>Оповещения</h2>
          <span className="counter">{unreadCount}</span>
        </div>
        <div className="pending-list">
          {reports.map((report) => (
            <article key={report.id} className="notification-item">
              <button className="notification-summary" type="button" onClick={() => void toggleReport(report)}>
                <div>
                  <strong>Отчет по замечанию {report.remarkNumber}</strong>
                  <span>{report.fileName}</span>
                  <small>
                    {formatDateTime(report.createdAt)}
                    {readReportIds.has(report.id) ? " · прочитано" : " · новое"}
                  </small>
                </div>
                <span>{expandedId === report.id ? "Свернуть" : "Раскрыть"}</span>
              </button>
              {expandedId === report.id && (
                <div className="notification-body">
                  {loadingPreviewId === report.id ? (
                    <div className="empty-state small">Отчет загружается...</div>
                  ) : previewUrls[report.id] ? (
                    <iframe title={`Отчет ${report.remarkNumber}`} src={previewUrls[report.id]} />
                  ) : (
                    <div className="empty-state small">Не удалось открыть отчет</div>
                  )}
                  <button className="secondary-button" type="button" onClick={() => download(report)}>
                    <Download size={17} /> Скачать PDF
                  </button>
                </div>
              )}
            </article>
          ))}
          {!reports.length && <div className="empty-state small">Отчетов об устранении пока нет</div>}
        </div>
      </section>
    </section>
  );
}

function EmployeeManagementView({
  pendingUsers,
  managedUsers,
  branches,
  currentUser,
  activeTab,
  onTabChange,
  onChanged,
  onError,
}: {
  pendingUsers: User[];
  managedUsers: User[];
  branches: Branch[];
  currentUser: UserInfo;
  activeTab: EmployeeTab;
  onTabChange: (tab: EmployeeTab) => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const ownBranchUsers = pendingUsers.filter((item) => item.branchId === currentUser.branchId);

  return (
    <section className="approval-view">
      <div className="management-tabs">
        <div className="tabs section-tabs">
          <button className={activeTab === "pending" ? "active" : ""} type="button" onClick={() => onTabChange("pending")}>
            Согласование заявок
          </button>
          <button className={activeTab === "employees" ? "active" : ""} type="button" onClick={() => onTabChange("employees")}>
            Список сотрудников
          </button>
        </div>
      </div>
      {activeTab === "pending" ? (
        <PendingUsers
          title="Заявки моего филиала"
          users={ownBranchUsers}
          branches={branches}
          onChanged={onChanged}
          onError={onError}
        />
      ) : (
        <section className="panel">
          <div className="panel-title">
            <h2>Список сотрудников</h2>
            <span className="counter">{managedUsers.length}</span>
          </div>
          <EmployeeList
            users={managedUsers}
            branches={branches}
            currentUser={currentUser}
            onChanged={onChanged}
            onError={onError}
          />
        </section>
      )}
    </section>
  );
}
function EmployeeList({
  users,
  branches,
  currentUser,
  onChanged,
  onError,
}: {
  users: User[];
  branches: Branch[];
  currentUser: UserInfo;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  async function dismiss(user: User) {
    const role = user.roles[0];
    const canDismiss =
      (hasRole(currentUser, ["ADMIN"]) && (role === "MASTER" || role === "BRANCH_HEAD")) ||
      (hasRole(currentUser, ["BRANCH_HEAD"]) && role === "MASTER");

    if (!canDismiss) {
      onError("Недостаточно прав для сокращения сотрудника");
      return;
    }

    try {
      await api.dismissUser(user.id);
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не удалось сократить сотрудника");
    }
  }

  return (
    <div className="pending-list">
      {users.map((item) => (
        <article key={item.id} className="pending-item">
          <div>
            <strong>{item.fullName}</strong>
            <span>{item.email}</span>
            <small>
              {roleLabel[item.roles[0]] ?? "Роль"} · {branchName(branches, item.branchId)}
            </small>
          </div>
          <div className="decision-buttons">
            <button type="button" onClick={() => dismiss(item)} title="Сократить">
              <UserMinus size={17} />
            </button>
          </div>
        </article>
      ))}
      {!users.length && <div className="empty-state small">Сотрудников для управления нет</div>}
    </div>
  );
}
