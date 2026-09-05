import { useState } from 'react';
import { api } from '@/client/api/client.js';
import { VsCode } from '@/client/components/icons.js';
import { Button } from '@/client/ui/index.js';

export function EditorLink({
  filePath,
  line,
}: {
  filePath: string;
  line?: number;
}) {
  const [err, setErr] = useState(false);
  const open = async () => {
    try {
      await api.openEditor(filePath, line);
      setErr(false);
    } catch {
      setErr(true);
    }
  };
  return (
    <Button
      small
      icon
      variant="invisible"
      onClick={open}
      title={err ? 'VS Code did not open' : 'Open in VS Code'}
      aria-label="Open in VS Code"
    >
      <VsCode />
    </Button>
  );
}
