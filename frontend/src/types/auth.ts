export type AuthLoginResponse = {
  userId: string
  email: string
  firstName: string
  lastName: string
  accessToken: string
  // refreshToken removed — stored in httpOnly cookie, not in response body
  expiresAt?: string
  twoFactorEnabled: boolean
}

export type AuthRegisterResponse = {
  userId: string
  email: string
  firstName: string
  lastName: string
  accessToken: string
  // refreshToken removed — stored in httpOnly cookie, not in response body
  expiresAt?: string
}

export type AuthTokenDto = {
  accessToken: string
  expiresAt?: string
  tokenType?: string
  rememberMe?: boolean
}

export type TokenValidationDto = {
  isValid: boolean
  userId?: string | null
  email?: string | null
  expiresAt?: string | null
  message?: string | null
  roles?: string[] | null
}

export type UserDto = {
  id: string
  email: string
  firstName: string
  lastName: string
  profilePictureUrl?: string | null
  status: string
  isEmailVerified: boolean
  emailVerifiedAt?: string | null
  lastLoginAt?: string | null
  twoFactorEnabled: boolean
  createdAt: string
}

export type UserSecurityDto = {
  userId: string
  twoFactorEnabled: boolean
  activeSessionsCount: number
  lastPasswordChange?: string | null
  lastEmailChange?: string | null
  failedLoginAttempts: number
  lockedUntil?: string | null
  activeTokens: RefreshTokenDetailDto[]
  recentLogins: LoginHistoryDto[]
}

export type RefreshTokenDetailDto = {
  id: string
  expiresAt: string
  createdAt: string
  createdByIp: string
  isActive: boolean
  isExpired: boolean
  isRevoked: boolean
  revokedAt?: string | null
  revokedByIp?: string | null
  revokedReason?: string | null
  replacedByToken?: string | null
}

export type LoginHistoryDto = {
  id: string
  ipAddress: string
  userAgent: string
  isSuccessful: boolean
  loginAt: string
  failureReason?: string | null
}

export type LoginHistoryPagedDto = {
  id: string
  ipAddress: string
  userAgent: string
  isSuccessful: boolean
  loginAt: string
  failureReason?: string | null
  location: string
  device: string
  browser: string
}

export type SessionDto = {
  id: string
  deviceName: string
  browser: string
  ipAddress: string
  location: string
  isCurrent: boolean
  createdAt: string
  lastActivityAt?: string | null
  expiresAt: string
}

export type UserListDto = {
  id: string
  email: string
  firstName: string
  lastName: string
  status: string
  lastLoginAt?: string | null
  createdAt: string
}

export type UserDetailDto = {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  profilePictureUrl?: string | null
  status: string
  isEmailVerified: boolean
  emailVerifiedAt?: string | null
  lastLoginAt?: string | null
  twoFactorEnabled: boolean
  failedLoginAttempts: number
  lockedUntil?: string | null
  createdAt: string
  updatedAt?: string | null
  recentLogins: LoginHistoryDto[]
}

export type UserStatisticsDto = {
  totalUsers: number
  activeUsers: number
  inactiveUsers: number
  lockedUsers: number
  usersWithTwoFactor: number
  newUsersToday: number
  newUsersThisWeek: number
  newUsersThisMonth: number
  lastUpdated: string
}

export type FriendDto = {
  id: string
  email: string
  firstName: string
  lastName: string
  profilePictureUrl?: string | null
  friendsSince: string
}

export type FriendRequestDto = {
  friendshipId: string
  userId: string
  email: string
  firstName: string
  lastName: string
  profilePictureUrl?: string | null
  requestedAt: string
  status: string
}

export type PagedResult<T> = {
  items: T[]
  pageNumber: number
  pageSize: number
  totalCount: number
  totalPages: number
  hasPreviousPage: boolean
  hasNextPage: boolean
}
