export type RoleCode = "APPLICANT" | "MASTER" | "BRANCH_HEAD" | "ADMIN";
export type UserStatus = "PENDING" | "ACTIVE" | "REJECTED" | "DISMISSED";
export type RemarkStatus = "NEW" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED";
export type EstimatedResolutionUnit = "HOURS" | "DAYS" | "WEEKS";

export type Branch = {
  id: string;
  code: string;
  name: string;
  active: boolean;
};

export type User = {
  id: string;
  email: string;
  fullName: string;
  position: string;
  branchId: string;
  status: UserStatus;
  roles: RoleCode[];
  createdAt: string;
  updatedAt: string;
};

export type UserInfo = {
  userId: string;
  email: string;
  fullName: string;
  position: string;
  branchId: string;
  roles: RoleCode[];
};

export type LoginResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  user: UserInfo;
};

export type Remark = {
  id: string;
  remarkNumber: string;
  branchId: string;
  objectBuilding: string;
  description: string;
  discoveredAt: string;
  createdByUserId: string;
  assignedMasterId: string | null;
  estimatedResolutionDuration: number | null;
  estimatedResolutionUnit: EstimatedResolutionUnit | null;
  estimatedResolutionAt: string | null;
  status: RemarkStatus;
  resolutionMessage: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  reportSentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RemarkCalendarEvent = {
  remarkId: string;
  remarkNumber: string;
  title: string;
  objectBuilding: string;
  status: RemarkStatus;
  workDate: string;
  workStartTime: string;
  workEndTime: string;
  start: string;
  end: string;
  estimatedResolutionAt: string;
  customTime: boolean;
};

export type CreateRemarkPayload = {
  objectBuilding: string;
  description: string;
  discoveredAt: string;
};

export type RegisterPayload = {
  email: string;
  password: string;
  fullName: string;
  position: string;
  branchId: string;
  requestedRole: RoleCode;
};

export type ReportNotification = {
  id: string;
  remarkId: string;
  remarkNumber: string;
  fileName: string;
  createdAt: string;
};

export type PagedRemarks = {
  content: Remark[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
};
