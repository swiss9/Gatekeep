import { useEffect, useState } from 'react';
import { api, type AdminInvite, type Profile } from '../../lib/api';
import { openTelegramLink } from '../../lib/telegram';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME;

function inviteLink(token: string): string {
  return `https://t.me/${BOT_USERNAME}?startapp=inv_${token}`;
}

export function Team() {
  const auth = useAuth();
  const toast = useToast();
  const [team, setTeam] = useState<Profile[]>([]);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [transferTarget, setTransferTarget] = useState<Profile | null>(null);
  const [confirmName, setConfirmName] = useState('');

  const me = auth.status === 'ready' ? auth.profile : null;
  const isSuper = me?.role === 'superadmin';

  const load = () =>
    Promise.all([api.team(), api.listInvites()])
      .then(([t, i]) => {
        setTeam(t.team);
        setInvites(i.invites);
      })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : 'Load failed'));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createInvite = async (role: 'admin' | 'superadmin') => {
    try {
      const { invite } = await api.createInvite(role);
      await load();
      const url = inviteLink(invite.token);
      try {
        await navigator.clipboard.writeText(url);
        toast('Invite link copied');
      } catch {
        toast('Invite created');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Invite failed');
    }
  };

  const revoke = async (inv: AdminInvite) => {
    if (!window.confirm('Revoke this invite?')) return;
    try {
      await api.revokeInvite(inv.id);
      await load();
      toast('Invite revoked');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Revoke failed');
    }
  };

  const removeMember = async (p: Profile) => {
    if (!window.confirm(`Remove ${p.first_name ?? 'this admin'}?`)) return;
    try {
      await api.removeMember(p.id);
      await load();
      toast('Member removed');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Remove failed');
    }
  };

  const promote = async (p: Profile) => {
    try {
      await api.setMemberRole(p.id, 'superadmin');
      await load();
      toast('Promoted to superadmin');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Promote failed');
    }
  };

  const demote = async (p: Profile) => {
    try {
      await api.setMemberRole(p.id, 'admin');
      await load();
      toast('Demoted to admin');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Demote failed');
    }
  };

  const confirmTransfer = async () => {
    if (!transferTarget) return;
    if (confirmName.trim() !== (transferTarget.first_name ?? '')) {
      toast('Name does not match');
      return;
    }
    try {
      await api.transferOwnership(transferTarget.id);
      toast('Ownership transferred. Reload the app.');
      setTransferTarget(null);
      setConfirmName('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Transfer failed');
    }
  };

  const pendingInvites = invites.filter((i) => !i.used_by && new Date(i.expires_at) > new Date());

  return (
    <>
      <span className="section-title" style={{ display: 'block', marginTop: 22 }}>
        Team
      </span>
      <div className="inv-list">
        {team.map((p) => {
          const isSelf = p.id === me?.id;
          return (
            <div className="inv-row" key={p.id} style={{ flexWrap: 'wrap' }}>
              <div className="inv-info" style={{ minWidth: 0 }}>
                <div className="inv-name">
                  {p.first_name ?? 'Unknown'} {p.username ? `@${p.username}` : ''}
                </div>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className={`role-badge ${p.role}`}>{p.role}</span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    joined {new Date(p.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {isSuper && !isSelf && p.role === 'admin' && (
                  <button type="button" className="link-btn" onClick={() => promote(p)}>
                    Promote
                  </button>
                )}
                {isSuper && !isSelf && p.role === 'superadmin' && (
                  <button type="button" className="link-btn" onClick={() => demote(p)}>
                    Demote
                  </button>
                )}
                {(isSuper || isSelf) && (
                  <button type="button" className="link-btn" onClick={() => removeMember(p)}>
                    {isSelf ? 'Leave' : 'Remove'}
                  </button>
                )}
                {isSuper && !isSelf && p.role !== 'superadmin' && (
                  <button type="button" className="link-btn" onClick={() => setTransferTarget(p)}>
                    Transfer
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="dashed-btn" style={{ marginTop: 0 }} onClick={() => createInvite('admin')}>
          Invite admin
        </button>
        {isSuper && (
          <button
            type="button"
            className="dashed-btn"
            style={{ marginTop: 0 }}
            onClick={() => createInvite('superadmin')}
          >
            Invite superadmin
          </button>
        )}
      </div>

      {pendingInvites.length > 0 && (
        <>
          <span className="section-title" style={{ display: 'block', marginTop: 26 }}>
            Pending invites
          </span>
          <div className="inv-list">
            {pendingInvites.map((inv) => {
              const url = inviteLink(inv.token);
              return (
                <div className="inv-row" key={inv.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className={`role-badge ${inv.grants_role}`}>{inv.grants_role}</span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      expires {new Date(inv.expires_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="invite-link">{url}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        void navigator.clipboard.writeText(url);
                        toast('Copied');
                      }}
                    >
                      Copy
                    </button>
                    <button type="button" className="link-btn" onClick={() => openTelegramLink(url)}>
                      Share
                    </button>
                    <button type="button" className="link-btn" onClick={() => revoke(inv)}>
                      Revoke
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {transferTarget && (
        <div className="modal-back" onClick={() => setTransferTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Transfer ownership</h3>
            <p>
              You will be demoted to admin and <strong>{transferTarget.first_name ?? 'they'}</strong> will become
              superadmin. Type their first name to confirm.
            </p>
            <div className="field">
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={transferTarget.first_name ?? ''}
              />
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setTransferTarget(null)}>
                Cancel
              </button>
              <button type="button" className="danger" onClick={confirmTransfer}>
                Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
