import { app, nativeImage } from 'electron';
import * as path from 'path';

export function setDockIcon(): boolean {
  if (!app.dock) return false;

  const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  if (icon.isEmpty()) {
    console.warn(`[app-icon] failed to load ${iconPath}`);
    return false;
  }

  app.dock.setIcon(icon);
  return true;
}
