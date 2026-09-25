import { WorkspaceClient } from '@/components/autobidder/workspace-client';
import { ChatWidget } from '@/src/components/ChatWidget';

export default function Page() {
  return (
    <>
      <WorkspaceClient />
      <ChatWidget />
    </>
  );
}
