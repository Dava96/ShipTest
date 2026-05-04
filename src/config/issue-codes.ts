export const ConfigIssueCode = {
  ConfigFileNotFound: "CONFIG_FILE_NOT_FOUND",
  ConfigSchemaInvalid: "CONFIG_SCHEMA_INVALID",
  ProjectRepoNotFound: "PROJECT_REPO_NOT_FOUND",
  ReferencedDirectoryNotFound: "REFERENCED_DIRECTORY_NOT_FOUND",
  ReferencedFileNotFound: "REFERENCED_FILE_NOT_FOUND",
  UnsafeWorkspacePath: "UNSAFE_WORKSPACE_PATH",
} as const;

export type ConfigIssueCode = (typeof ConfigIssueCode)[keyof typeof ConfigIssueCode];
