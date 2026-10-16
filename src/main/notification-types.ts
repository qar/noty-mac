export type NotificationType = 'tmux-agent' | 'plane';

export interface ChannelOptions {
  type?: NotificationType;
  planeBaseUrl?: string;
  planeWorkspaceSlug?: string;
  accessToken?: string;
  planeApiKey?: string;
}

export interface Channel extends ChannelOptions {
  id: string;
  name: string;
  url: string;
  encryptedAccessToken?: string;
  hasAccessToken?: boolean;
  encryptedPlaneApiKey?: string;
  hasPlaneApiKey?: boolean;
}

export interface PlaneEvent {
  attachment?: {
    url: string;
    name: string;
    size?: number;
    status: 'loaded' | 'error';
    error?: string;
  };
  sourceClick?: string;
  deliveryId: string;
  event: string;
  action: string;
  field: string;
  issueId: string;
  projectId: string;
  workspaceSlug: string;
  url: string | null;
  rawPayload: string;
  issueIdentifier?: string;
  issueName?: string;
  commentAuthor?: string;
  commentCreatedAt?: string;
  parseError?: string;
}

export interface AppNotification {
  id: string;
  ntfyId?: string | null;
  channelId: string;
  type?: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  completedAt?: number | null;
  metadata?: {
    tmux?: { target: string; session?: string };
    project?: { name: string; branch?: string };
    chainTestApp?: string;
    plane?: PlaneEvent;
  };
}
