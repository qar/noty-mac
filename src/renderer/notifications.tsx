import { createRoot } from 'react-dom/client';
import { NotificationList } from './notification-list';
import { installKeyboardNavigation } from './keyboard-navigation';

installKeyboardNavigation();
createRoot(document.getElementById('root')!).render(<NotificationList />);
