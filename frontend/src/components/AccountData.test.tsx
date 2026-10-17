import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountData } from './AccountData';
import { api } from '../lib/api';
import { emptyExportCursor } from '../lib/workspaceExport';
import * as exports from '../lib/workspaceExport';

const { auth }=vi.hoisted(()=>({auth:{user:{id:42,email:'owner@example.com'}}}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>auth}));
vi.mock('../hooks/useUnsavedChanges',()=>({useUnsavedChangesGuard:()=>({allowNextNavigation:vi.fn()})}));
const confirmed={proof:'private-memory-proof',expires_in_seconds:900,account:{id:42},max_file_bytes:50_000_000};
const part={blob:new Blob(['{"records":[]}']),cursor:{...emptyExportCursor(),category:4,part:1},complete:true,records:0};
beforeEach(()=>{auth.user={id:42,email:'owner@example.com'};vi.spyOn(api,'post').mockResolvedValue({data:confirmed});});
afterEach(()=>vi.unstubAllGlobals());
function setup(){return render(<AccountData profileBlocked={false} onBusyChange={vi.fn()}/>);}
async function confirm(){fireEvent.change(screen.getByLabelText('Password for export'),{target:{value:'current-password'}});fireEvent.click(screen.getByRole('button',{name:'Confirm password'}));await screen.findByText(/Password confirmed/);}

it('shows the confirmed public operator and real contact without inventing deletion or retention controls',()=>{
 setup();expect(screen.getByText(/Deepanshu Singh, operating/)).toBeVisible();
 expect(screen.getByRole('link',{name:/deepanshu1927@outlook.com/})).toHaveAttribute('href',expect.stringContaining('mailto:deepanshu1927@outlook.com'));
 expect(screen.getByText(/Sending a request does not itself delete/)).toBeVisible();
 expect(screen.getByRole('button',{name:'Prepare workspace export'})).toBeDisabled();
});
it('confirms once, clears the password and downloads a complete part without revoking sessions',async()=>{
 vi.spyOn(exports,'prepareExportPart').mockResolvedValue(part);const download=vi.spyOn(exports,'startDownload').mockReturnValue(vi.fn());setup();await confirm();
 expect(api.post).toHaveBeenCalledWith('/account-data/authorize',{current_password:'current-password'},expect.objectContaining({signal:expect.any(Object)}));
 expect(screen.queryByLabelText('Password for export')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Prepare workspace export'}));await screen.findByRole('button',{name:'Download part 1 (final)'});
 fireEvent.click(screen.getByRole('button',{name:'Download part 1 (final)'}));
 expect(download).toHaveBeenCalledWith(part.blob,expect.stringMatching(/^dataplatform-workspace-[0-9TZ]+-part-001\.json$/));
 expect(screen.getByRole('button',{name:'All parts prepared'})).toBeDisabled();expect(localStorage.length).toBe(0);
});
it('wrong password clears the secret and keeps the form available',async()=>{
 vi.mocked(api.post).mockRejectedValue({response:{status:400,data:{detail:'The current password is incorrect.'}}});setup();
 fireEvent.change(screen.getByLabelText('Password for export'),{target:{value:'wrong'}});fireEvent.click(screen.getByRole('button',{name:'Confirm password'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('incorrect');expect(screen.getByLabelText('Password for export')).toHaveValue('');
});
it('cancels stale preparation without producing a download or losing the old cursor',async()=>{
 let resolve!:(v:typeof part)=>void;vi.spyOn(exports,'prepareExportPart').mockImplementation(()=>new Promise(r=>{resolve=r;}));const download=vi.spyOn(exports,'startDownload');setup();await confirm();
 fireEvent.click(screen.getByRole('button',{name:'Prepare workspace export'}));fireEvent.click(screen.getByRole('button',{name:'Cancel preparation'}));
 await act(async()=>{resolve(part);});expect(screen.queryByRole('button',{name:/Download part/})).not.toBeInTheDocument();expect(download).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Prepare workspace export'})).toBeEnabled();
});
it('invalidates an expired proof and keeps the export retryable',async()=>{
 vi.spyOn(exports,'prepareExportPart').mockRejectedValue({response:{status:403,data:{detail:'Confirm your password again.'}}});setup();await confirm();
 fireEvent.click(screen.getByRole('button',{name:'Prepare workspace export'}));expect(await screen.findByRole('alert')).toHaveTextContent('Confirm your password again');
 expect(screen.getByLabelText('Password for export')).toHaveValue('');expect(screen.getByRole('button',{name:'Prepare workspace export'})).toBeDisabled();
});
it('drops old proof and aborts in-flight work when the account changes',async()=>{
 let resolve!:(v:typeof part)=>void;const prepare=vi.spyOn(exports,'prepareExportPart').mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=setup();await confirm();
 fireEvent.click(screen.getByRole('button',{name:'Prepare workspace export'}));auth.user={id:99,email:'other@example.com'};
 view.rerender(<AccountData profileBlocked={false} onBusyChange={vi.fn()}/>);await act(async()=>resolve(part));
 expect(prepare.mock.calls[0][0].signal.aborted).toBe(true);expect(screen.queryByRole('button',{name:/Download part/})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Prepare workspace export'})).toBeDisabled();
});
