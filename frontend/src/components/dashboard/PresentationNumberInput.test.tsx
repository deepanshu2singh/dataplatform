import { useState } from 'react';
import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect,it } from 'vitest';
import { PresentationNumberInput } from './PresentationNumberInput';
function Harness(){const [n,set]=useState<number|null>(6);return <><PresentationNumberInput aria-label="Width" value={n} min={3} max={12} onCommit={set}/><output>{n}</output><button>Done</button></>;}
it('keeps a complete numeric draft before clamping and committing on blur or Enter',async()=>{
  const user=userEvent.setup();render(<Harness/>);const input=screen.getByRole('spinbutton');
  await user.clear(input);await user.type(input,'10');expect(input).toHaveValue(10);expect(screen.getByRole('status')).toHaveTextContent('6');
  await user.click(screen.getByRole('button'));expect(screen.getByRole('status')).toHaveTextContent('10');
  await user.clear(input);await user.type(input,'90{Enter}');expect(input).toHaveValue(12);
});
