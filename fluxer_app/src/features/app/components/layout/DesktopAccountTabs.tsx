// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/app/components/layout/DesktopAccountTabs.module.css';
import AccountSwitcherModal from '@app/features/auth/components/accounts/AccountSwitcherModal';
import {getAccountAvatarUrl, getAccountDisplayName} from '@app/features/auth/components/accounts/AccountListItem';
import AccountManager from '@app/features/auth/state/AccountManager';
import {showBrowserLoginHandoffModal} from '@app/features/auth/flow/BrowserLoginHandoffModal';
import * as AuthenticationCommands from '@app/features/auth/commands/AuthenticationCommands';
import {MockAvatar} from '@app/features/ui/components/MockAvatar';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import {GearIcon, PlusIcon} from '@phosphor-icons/react';
import clsx from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback} from 'react';

function getInstanceHostLabel(account: {instance?: {apiEndpoint?: string}}): string | null {
	const endpoint = account.instance?.apiEndpoint;
	if (!endpoint) {
		return null;
	}
	try {
		return new URL(endpoint).hostname;
	} catch {
		return null;
	}
}

export const DesktopAccountTabs = observer(function DesktopAccountTabs() {
	const currentAccount = AccountManager.currentAccount;
	const accounts = AccountManager.getAllAccounts();
	const isBusy = AccountManager.isSwitching || AccountManager.isLoading;
	const handleAddAccount = useCallback(() => {
		showBrowserLoginHandoffModal(async (payload) => {
			await AuthenticationCommands.completeLogin(payload);
		});
	}, []);
	const openManageAccounts = useCallback(() => {
		ModalCommands.push(modal(() => <AccountSwitcherModal data-flx="app.desktop-account-tabs.account-switcher-modal" />));
	}, []);
	if (accounts.length === 0) {
		return null;
	}
	return (
		<div className={styles.tabBar} data-flx="app.desktop-account-tabs.tab-bar">
			<div className={styles.tabs} data-flx="app.desktop-account-tabs.tabs">
				{accounts.map((account) => {
					const isActive = account.userId === currentAccount?.userId;
					const displayName = getAccountDisplayName(account, account.userId);
					const instanceHost = getInstanceHostLabel(account);
					return (
						<Tooltip
							key={account.userId}
							text={instanceHost ? `${displayName} · ${instanceHost}` : displayName}
							position="bottom"
							data-flx="app.desktop-account-tabs.tooltip"
						>
							<button
								type="button"
								className={clsx(styles.tab, isActive && styles.tabActive, account.isValid === false && styles.tabExpired)}
								disabled={isBusy}
								onClick={() => {
									if (isActive || isBusy) {
										return;
									}
									void AccountManager.switchToAccount(account.userId);
								}}
								aria-label={displayName}
								data-flx="app.desktop-account-tabs.tab"
							>
								<MockAvatar
									size={18}
									avatarUrl={getAccountAvatarUrl(account)}
									userTag={displayName}
									data-flx="app.desktop-account-tabs.mock-avatar"
								/>
								<span className={styles.tabLabel} data-flx="app.desktop-account-tabs.tab-label">
									{displayName}
								</span>
								{instanceHost ? (
									<span className={styles.instanceBadge} data-flx="app.desktop-account-tabs.instance-badge">
										{instanceHost}
									</span>
								) : null}
							</button>
						</Tooltip>
					);
				})}
			</div>
			<div className={styles.actions} data-flx="app.desktop-account-tabs.actions">
				<button
					type="button"
					className={styles.iconButton}
					disabled={isBusy}
					onClick={handleAddAccount}
					aria-label="Add account"
					data-flx="app.desktop-account-tabs.icon-button.add-account"
				>
					<PlusIcon size={14} weight="bold" data-flx="app.desktop-account-tabs.plus-icon" />
				</button>
				<button
					type="button"
					className={styles.iconButton}
					disabled={isBusy}
					onClick={openManageAccounts}
					aria-label="Manage accounts"
					data-flx="app.desktop-account-tabs.icon-button.manage-accounts"
				>
					<GearIcon size={14} weight="bold" data-flx="app.desktop-account-tabs.gear-icon" />
				</button>
			</div>
		</div>
	);
});
