import * as vscode from "vscode"

export type ApiProfileSourceType = "url" | "file"
export type ApiProfileStatus = "online" | "offline" | "changed" | "unchanged" | "unknown"

export interface ApiProfile {
  id: string
  name: string
  sourceType: ApiProfileSourceType
  url?: string
  filePath?: string
  outputPath?: string
  outputSplit?: string
  selectedControllers?: string[]
  autoWatch: boolean
  lastDocHash?: string
  lastCheckedAt?: number
  lastGeneratedAt?: number
  status: ApiProfileStatus
  statusMessage?: string
}

const PROFILES_KEY = "apiProfiles"
const DEFAULT_PROFILE_KEY = "defaultApiProfileId"

export class ApiProfileManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getProfiles(): ApiProfile[] {
    return this.context.workspaceState.get<ApiProfile[]>(PROFILES_KEY, [])
  }

  async saveProfiles(profiles: ApiProfile[]): Promise<void> {
    await this.context.workspaceState.update(PROFILES_KEY, profiles)
  }

  getDefaultProfileId(): string | undefined {
    return this.context.workspaceState.get<string>(DEFAULT_PROFILE_KEY)
  }

  getDefaultProfile(): ApiProfile | undefined {
    const profiles = this.getProfiles()
    const defaultId = this.getDefaultProfileId()
    return profiles.find((profile) => profile.id === defaultId) || profiles[0]
  }

  async setDefaultProfile(id: string): Promise<void> {
    await this.context.workspaceState.update(DEFAULT_PROFILE_KEY, id)
  }

  async upsertProfile(profile: ApiProfile): Promise<void> {
    const profiles = this.getProfiles()
    const index = profiles.findIndex((item) => item.id === profile.id)
    if (index >= 0) {
      profiles[index] = profile
    } else {
      profiles.unshift(profile)
    }
    await this.saveProfiles(profiles)
    if (!this.getDefaultProfileId()) {
      await this.setDefaultProfile(profile.id)
    }
  }

  async updateProfile(id: string, patch: Partial<ApiProfile>): Promise<ApiProfile | undefined> {
    const profiles = this.getProfiles()
    const index = profiles.findIndex((item) => item.id === id)
    if (index < 0) return undefined
    const next = { ...profiles[index], ...patch }
    profiles[index] = next
    await this.saveProfiles(profiles)
    return next
  }

  async deleteProfile(id: string): Promise<void> {
    const profiles = this.getProfiles().filter((item) => item.id !== id)
    await this.saveProfiles(profiles)
    if (this.getDefaultProfileId() === id) {
      await this.context.workspaceState.update(DEFAULT_PROFILE_KEY, profiles[0]?.id)
    }
  }
}

export function createProfileId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
