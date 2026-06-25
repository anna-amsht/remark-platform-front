import type {
  Branch,
  CreateRemarkPayload,
  LoginResponse,
  RegisterPayload,
  ReportNotification,
  Remark,
  RemarkStatus,
  RoleCode,
  User,
  UserInfo,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

type RequestOptions = RequestInit & {
  auth?: boolean;
  retry?: boolean;
};

let accessToken = sessionStorage.getItem("remark.accessToken") ?? "";
let currentUser: UserInfo | null = readStoredUser();

function readStoredUser(): UserInfo | null {
  const raw = sessionStorage.getItem("remark.user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserInfo;
  } catch {
    return null;
  }
}

function storeSession(token: string, user?: UserInfo) {
  accessToken = token;
  sessionStorage.setItem("remark.accessToken", token);
  if (user) {
    currentUser = user;
    sessionStorage.setItem("remark.user", JSON.stringify(user));
  }
}

function clearSession() {
  accessToken = "";
  currentUser = null;
  sessionStorage.removeItem("remark.accessToken");
  sessionStorage.removeItem("remark.user");
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (options.auth !== false && accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (response.status === 401 && options.auth !== false && options.retry !== false) {
    const refreshed = await refreshToken();
    if (refreshed) {
      return request<T>(path, { ...options, retry: false });
    }
  }

  if (!response.ok) {
    throw new Error(await extractError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function requestBlob(path: string): Promise<{ blob: Blob; fileName: string }> {
  const headers = new Headers();
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await extractError(response));
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const fileNameMatch = disposition.match(/filename="?([^"]+)"?/);
  return {
    blob: await response.blob(),
    fileName: fileNameMatch?.[1] ?? "report.pdf",
  };
}

async function extractError(response: Response): Promise<string> {
  const fallback = `Ошибка ${response.status}`;
  try {
    const body = await response.json();
    return body.detail || body.message || body.title || fallback;
  } catch {
    return fallback;
  }
}

async function refreshToken(): Promise<boolean> {
  try {
    const data = await request<{ accessToken: string }>("/api/v1/auth/refresh", {
      method: "POST",
      auth: false,
      retry: false,
    });
    storeSession(data.accessToken);
    return true;
  } catch {
    clearSession();
    return false;
  }
}

export const session = {
  get token() {
    return accessToken;
  },
  get user() {
    return currentUser;
  },
  clear: clearSession,
};

export const api = {
  async login(email: string, password: string) {
    const data = await request<LoginResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      auth: false,
    });
    storeSession(data.accessToken, data.user);
    return data;
  },
  async logout() {
    try {
      await request<void>("/api/v1/auth/logout", { method: "POST" });
    } finally {
      clearSession();
    }
  },
  branches() {
    return request<Branch[]>("/api/v1/refs/branches", { auth: false });
  },
  register(payload: RegisterPayload) {
    return request<User>("/api/v1/users/register", {
      method: "POST",
      body: JSON.stringify(payload),
      auth: false,
    });
  },
  me() {
    return request<User>("/api/v1/users/me");
  },
  user(id: string) {
    return request<User>(`/api/v1/users/${id}`);
  },
  pendingUsers() {
    return request<User[]>("/api/v1/users/pending");
  },
  approveUser(id: string) {
    return request<User>(`/api/v1/users/${id}/approve`, { method: "PATCH" });
  },
  rejectUser(id: string) {
    return request<User>(`/api/v1/users/${id}/reject`, { method: "PATCH" });
  },
  managedUsers() {
    return request<User[]>("/api/v1/users/managed");
  },
  dismissUser(id: string) {
    return request<User>(`/api/v1/users/${id}/dismiss`, { method: "PATCH" });
  },
  usersByRole(branchId: string, role: RoleCode) {
    const params = new URLSearchParams({ branchId, role });
    return request<User[]>(`/api/v1/users?${params}`);
  },
  remarks(status?: RemarkStatus, branchIdFilter?: string) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (branchIdFilter) params.set("branchIdFilter", branchIdFilter);
    const query = params.toString();
    return request<Remark[]>(`/api/v1/remarks${query ? `?${query}` : ""}`);
  },
  createRemark(payload: CreateRemarkPayload) {
    return request<Remark>("/api/v1/remarks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  assignMaster(id: string, masterId: string) {
    return request<Remark>(`/api/v1/remarks/${id}/assign`, {
      method: "PATCH",
      body: JSON.stringify({ masterId }),
    });
  },
  startWork(id: string) {
    return request<Remark>(`/api/v1/remarks/${id}/start`, { method: "PATCH" });
  },
  setEstimatedResolution(id: string, estimatedResolutionAt: string) {
    return request<Remark>(`/api/v1/remarks/${id}/estimated-resolution`, {
      method: "PATCH",
      body: JSON.stringify({ estimatedResolutionAt }),
    });
  },
  resolve(id: string, resolutionMessage: string) {
    return request<Remark>(`/api/v1/remarks/${id}/resolve`, {
      method: "PATCH",
      body: JSON.stringify({ resolutionMessage }),
    });
  },
  close(id: string) {
    return request<Remark>(`/api/v1/remarks/${id}/close`, { method: "PATCH" });
  },
  reports() {
    return request<ReportNotification[]>("/api/v1/reports");
  },
  downloadReport(id: string) {
    return requestBlob(`/api/v1/reports/${id}/download`);
  },
};
