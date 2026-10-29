# SoulLedger · egy 待补 · 第六十三批(2026-10-29)

以下键在中英已有、egy 待填(闭合词表;新词根请先告诉我)。请回一份 `egy-fill-2026-10-29-63.json`(键 → egy)。

| 键 | 中文 | English |
|---|---|---|
| `appeals.error.five_heinous_must_fail` | 原审罪目是五逆：不能改判通过。 | The original offence is one of the five heinous crimes: the appeal cannot amend it to passed. |
| `appeals.refusal.appeal_closed` | 这份申诉已有结论或已撤回，不能再撤回。 | This appeal has already been decided or withdrawn. |
| `appeals.refusal.ladder_running` | 这份申诉已进入申诉流程，流程走完前不能撤回。 | This appeal is in the appeal flow; it cannot be withdrawn until the flow is done. |
| `appeals.refusal.origin_flow_open` | 这件审判的审批流程还没走完，走完之后才能申诉或上诉 | This judgment's approval workflow has not finished; you can appeal once it has |
| `audit.sessions.confirm_all_message` | {{name}} 在所有设备上都会立即退出。 | {{name}} will be signed out on every device at once. |
| `audit.sessions.confirm_all_title` | 强退全部会话？ | Sign out every session? |
| `audit.sessions.confirm_message` | {{name}} 在「{{device}}」上会立即退出，要在那台设备上重新登录。 | {{name}} will be signed out on {{device}} at once and has to sign in again there. |
| `audit.sessions.confirm_title` | 强退这个会话？ | Sign out this session? |
| `audit.sessions.current` | （本机） | (this device) |
| `audit.sessions.device` | 设备 | Device |
| `audit.sessions.empty` | 现在没有人在线 | No one is signed in |
| `audit.sessions.filtered_by` | 只看 {{name}} | Only {{name}} |
| `audit.sessions.kind.officer` | 官员 | Officers |
| `audit.sessions.kind.soul` | 灵魂 | Souls |
| `audit.sessions.kind_label` | 账号类别 | Account type |
| `audit.sessions.last_seen` | 上次活动 | Last active |
| `audit.sessions.revoke` | 强退 | Sign out |
| `audit.sessions.revoke_all` | 强退全部设备 | Sign out everywhere |
| `audit.sessions.revoke_failed` | 没能强退，列表已刷新。 | Could not sign out. The list has been refreshed. |
| `audit.sessions.revoked` | 已让 {{name}} 在那台设备上退出 | {{name}} is signed out on that device |
| `audit.sessions.revoked_all` | 已让 {{name}} 在所有设备上退出 | {{name}} is signed out everywhere |
| `audit.sessions.signed_in` | 登录时间 | Signed in |
| `audit.sessions.title` | 在线会话 | Online sessions |
| `audit.sessions.user` | 账号 | Account |
| `audit.tabs.sessions` | 在线会话 | Online sessions |
| `death_sync.api_keys.create_no_tenant` | 请先进入一个殿再新建：密钥属于某一殿 | Enter a hall first: an API key belongs to one hall |
| `disposition.flow_waiting.approval_cancelled` | 审批流程因联审取消而中止，没有走完：不能直接执行。殿主（能改派案子的官员）可对这件审判「重开一案」。 | The approval workflow was cancelled with the joint judgment and never finished: it cannot be executed as is. The hall lead (an officer who can reassign cases) can reopen this judgment as a new case. |
| `disposition.release_error.generic` | 释放失败 | Release failed |
| `events.realtime.COMMENT_CREATED` | 新评论 | New comment |
| `events.realtime.COMMENT_DELETED` | 评论已删除 | Comment deleted |
| `events.realtime.NOTIFICATION_CREATED` | 新通知 | New notification |
| `events.realtime.POST_CREATED` | 新动态 | New post |
| `events.realtime.POST_DELETED` | 动态已删除 | Post deleted |
| `events.realtime.POST_UPDATED` | 动态已更新 | Post updated |
| `events.realtime.REACTION_ADDED` | 新回应 | Reaction added |
| `events.realtime.REACTION_REMOVED` | 回应已撤回 | Reaction removed |
| `events.realtime.SCHEDULER_RUN_FAILED` | 定时任务运行失败 | Scheduled task run failed |
| `events.realtime.USER_FOLLOWED` | 新关注者 | New follower |
| `events.realtime.USER_UNFOLLOWED` | 已取消关注 | Unfollowed |
| `events.realtime.fallback_death_sync` | 死亡登记有更新 | Death sync update |
| `events.realtime.fallback_dispatch` | 调度有更新 | Dispatch update |
| `events.realtime.fallback_social` | 动态有更新 | Social update |
| `events.realtime.fallback_workflow` | 审批有更新 | Workflow update |
| `judgment.claim.not_yours_readonly` | 此案由{{name}}认领，只有认领人能改；你可以查看。 | {{name}} has claimed this case; only they can change it. You can read it. |
| `judgment.claim.override_recorded` | 你不是认领人（此案由{{name}}认领），此操作会留痕。 | You are not the claimant ({{name}} has claimed this case); what you change here is recorded. |
| `judgment.claim.refused.assignee_out_of_scope` | 对方的数据范围看不到这条数据 | That officer's data scope cannot see this record |
| `judgment.detail.passed_barred_five_heinous` | 罪目是五逆：直入阿鼻，不能判通过。 | The offence is one of the five heinous crimes: it cannot be passed. |
| `judgment.detail.passed_barred_untruthful` | 有否定告白记为「不实」：不能判通过。可判天平摇摆，另开一次称量。 | A denial was recorded as untrue: the verdict cannot be passed. The scale can be left wavering for a new weighing. |
| `judgment.reopen_cancelled.button` | 重开一案 | Reopen as a new case |
| `judgment.reopen_cancelled.done` | 已重开：{{case_number}} | Reopened: {{case_number}} |
| `judgment.reopen_cancelled.hint` | 原审的审批流程已被撤销，发落停在这里。撤回结案，另开一件新案重审。 | This case's approval flow was cancelled and its disposition is stuck. Withdraw the conclusion and open a new case. |
| `judgment.reopen_cancelled.refusal.cannot_reopen` | 灵魂已经安置，不能这样重开；请走重开申请或申诉。 | The soul has already been placed; ask for a reopening or an appeal instead. |
| `judgment.reopen_cancelled.refusal.not_cancelled` | 这件案子的审批流程没有被撤销，不能这样重开。 | This case's approval flow was not cancelled, so it cannot be reopened this way. |
| `judgment.weighing.errors.approval_flow_required` | 原审须经审批流程结案，不能直接结案。 | An original judgment is concluded through its approval workflow, not directly. |
| `judgment.weighing.errors.weighing_flow_required` | 埃及的案子须经称心流程结案，不能直接结案。 | An Egyptian case is concluded through the weighing flow, not directly. |
| `officerHandover.letters_kept` | 你没有回信权限，{{n}} 封书信不移交，留在{{name}}名下。 | You cannot reply to letters, so {{n}} letters stay with {{name}} and are not handed over. |
| `officerHandover.problem.target_out_of_scope` | {{name}}的数据范围看不到要交出的某件审判或申诉。换一位接手人，或先调整他的数据范围。 | {{name}}'s data scope can't see some of the judgments or appeals to hand over. Pick someone else, or widen their data scope first. |
| `officerHandover.result_letters_kept` | {{n}} 封书信没有移交，仍在交出人名下（你没有回信权限）。 | {{n}} letters were not handed over and stay with the outgoing officer (you cannot reply to letters). |
| `officer_app.biometric.off_failed` | 没有认出{{bio}}，这项仍然开着。 | {{bio}} not recognised. This is still on. |
| `officer_app.biometric.prompt` | 批准或驳回前，确认是你本人。 | Confirm it is you before approving or rejecting. |
| `officer_app.biometric.prompt_off` | 关掉这项前，确认是你本人。 | Confirm it is you before turning this off. |
| `officer_app.judgment.flow_not_here` | 这条审批流程由别的殿主办，本殿在其中没有一段，这里看不到详情；进度见上一页。 | This approval flow is run by another hall and has no segment of yours, so its details are not shown here; its progress is on the previous page. |
| `officer_app.todo.empty_body_other` | 有轮到你的事时会推送给你。 | Anything that comes to you will be pushed to you. |
| `official_notify.wangsi_grievance_filed.body` | 灵魂「{{soul}}」提出了冤情申诉，等待审核。 | {{soul}} has filed a grievance, waiting for review. |
| `official_notify.wangsi_grievance_filed.title` | 枉死城有新申诉 | New grievance in the City of the Wrongfully Dead |
| `official_notify.workflow_timeout_failed.body` | 灵魂「{{soul}}」的审批流「{{workflow}}」在「{{node}}」超时，但超时动作没能执行，流程停在这一站，请人工处理。 | Step {{node}} of the approval flow {{workflow}} of soul {{soul}} timed out, but its timeout action could not be carried out. The flow waits at that step; please handle it by hand. |
| `official_notify.workflow_timeout_failed.title` | 审批超时处理失败 | Approval timeout failed |
| `org.delete_blocked_body.records` | 名下还有 {{souls}} 个灵魂、{{judgments}} 件审判。先把它们转到别的机构，再删。 | It still owns {{souls}} souls and {{judgments}} judgments. Move them to another unit first, then delete. |
| `org.move_and_delete` | 转移并删除 | Move and delete |
| `org.move_to` | 把名下的灵魂与审判转移到 | Move its souls and judgments to |
| `org.owner_change` | 修改 | Change |
| `org.owner_failed` | 所属机构没有改成 | The owning unit was not changed |
| `org.owner_label` | 所属机构 | Owning unit |
| `org.owner_out_of_scope` | 这个机构不在你的数据范围内 | That unit is outside your data scope |
| `org.owner_saved` | 所属机构已修改 | Owning unit changed |
| `org_select.implied` | 含于上级 | Included via parent |
| `org_select.no_match` | 没有匹配的机构 | No matching unit |
| `org_select.no_tenant` | 未归殿 | No hall |
| `permissions.datascope.admin_fixed` | 全部(固定) | All (fixed) |
| `permissions.datascope.default` | 默认范围 | Default scope |
| `permissions.datascope.follow_default` | 跟随默认 | Follow default |
| `permissions.datascope.load_error` | 数据范围读取失败 | Could not load the data scope |
| `permissions.datascope.orgs` | 机构 | Units |
| `permissions.datascope.orgs_for` | {{name}} · 机构 | {{name}} · units |
| `permissions.datascope.orgs_required` | 自定义机构至少选一个 | Choose at least one unit |
| `permissions.datascope.own_always` | 本人创建或被指派的数据在任何范围下都可见。 | Records a user created or was assigned stay visible to them under any scope. |
| `permissions.datascope.per_resource` | 按业务单独设置 | Set per record type |
| `permissions.datascope.read_only` | 只有不属于任何殿的管理员能改数据范围 | Only an administrator outside every hall can change data scope |
| `permissions.datascope.save` | 保存数据范围 | Save data scope |
| `permissions.datascope.save_error` | 数据范围保存失败 | Could not save the data scope |
| `permissions.datascope.saved` | 数据范围已保存，对方刷新后生效 | Data scope saved; it applies once they refresh |
| `permissions.datascope.scope.ALL` | 全部 | All |
| `permissions.datascope.scope.DEFINE` | 自定义机构 | Chosen units |
| `permissions.datascope.scope.ORG` | 本机构 | This unit only |
| `permissions.datascope.scope.ORG_CHILD` | 本机构及以下 | This unit and below |
| `permissions.datascope.scope.SELF` | 仅本人 | Own records only |
| `permissions.datascope.title` | 数据范围 | Data scope |
| `reincarnation.error.disposition_not_executed` | {{name}}还有没执行的处置，执行并期满之后才能转世。 | {{name}} still has a disposition that has not been executed; execute it and let the term run out before the rebirth. |
| `reincarnation.error.origin_flow_open` | {{name}}的原审审批流程还没走完，走完之后才能转世。 | {{name}}'s original approval workflow has not finished; the rebirth waits for it. |
| `reincarnation.error.rebirth_continent_not_applicable` | 四大部洲只在地府的人道：别的道、别的文明不指定部洲。 | Only a soul of Diyu reborn into the human path is born in one of the four continents. |
| `sentence_plan.errors.five_heinous_must_fail` | 罪目是五逆：直入阿鼻，不能判通过。 | The offence is one of the five heinous crimes: the verdict cannot be passed. |
| `sentence_plan.errors.not_original_judge` | 重开请求由原审判官本人决定；他不在职时，由原属殿能改派案子的官员决定 | A reopening request is decided by the original judge; when they are no longer on duty, by an officer of the home hall who can reassign cases |
| `soul_app.chat.errors.ticket_expired` | 这次查找已过期，请重新按编号查找。 | This search has expired. Look the code up again. |
| `soul_app.chat.errors.ticket_invalid` | 请重新按编号查找。 | Look the code up again. |
| `soul_app.errors.invalid_days` | 天数不在可选的范围内。 | That number of days is outside the allowed range. |
| `soul_push.wangsi_delivered.body` | 你的冤情申诉经审核属实，已超度出枉死城。打开灵魂簿查看。 | Your grievance was found true and you have been delivered from the City of the Wrongfully Dead. Open Soul Ledger to see it. |
| `soul_push.wangsi_delivered.title` | 冤情申诉:属实 · 已超度 | Grievance upheld: delivered |
| `soul_push.wangsi_rejected.body` | 你的冤情申诉经审核不属实。打开灵魂簿查看审核意见。 | Your grievance was not found true. Open Soul Ledger to read the reviewer's note. |
| `soul_push.wangsi_rejected.title` | 冤情申诉:不属实 | Grievance not upheld |
| `soul_push.wangsi_upheld.body` | 你的冤情申诉经审核属实，已提前出枉死城。打开灵魂簿查看。 | Your grievance was found true and you have been released early from the City of the Wrongfully Dead. Open Soul Ledger to see it. |
| `soul_push.wangsi_upheld.title` | 冤情申诉:属实 · 提前释放 | Grievance upheld: released early |
| `soul_push.wangsi_upheld_late.body` | 你的冤情申诉经审核属实。打开灵魂簿查看审核意见。 | Your grievance was found true. Open Soul Ledger to read the reviewer's note. |
| `soul_push.wangsi_upheld_late.title` | 冤情申诉:属实 | Grievance upheld |
| `souls.events.NEGATIVE_CONFESSION_HEARD` | 否定告白记完 | Negative confession heard |
| `users.organization_required` | 有殿的非管理员必须属于一个机构 | A hall member who is not an administrator must belong to a unit |
| `workflow.detail.advance_needs_reason` | 推进必须写明理由 | Advancing needs a reason |
| `workflow.detail.advance_reason_label` | 推进理由（必填，会写入审计） | Reason to advance (required, recorded in the audit log) |
| `workflow.detail.advance_reason_placeholder` | 为什么不经决定就越过当前这一站 | Why the current step is passed without a decision |
| `workflow.detail.refusals.escalate_past_final` | 越级推进最多到终审这一站：终审要由审批人判，不能越过。 | Escalation stops at the final review: the final review has to be decided, not escalated past. |
| `workflow.detail.refusals.five_heinous_must_fail` | 这件审判犯五逆却判了通过：不能批准。 | This judgment is passed on one of the five heinous crimes: it cannot be approved. |
| `workflow.editor.case_type_not_for_civilization` | 这个文明没有这种案件类型，换一个案件类型再保存。 | This civilization has no such case type; pick another case type and save again. |
| `workflow.start.errors.origin_flow_open` | 这个灵魂的原审审批流程还没走完，走完之后才能发起申诉审批 | This soul's original approval workflow has not finished; an appeal waits for it |
| `workflow.status.CANCELLED` | 已取消 | Cancelled |
| `mfa.manage.confirm_by_recovery` | 恢复码 | Recovery code |
| `mfa.manage.turn_off_body` | 关闭后登录只需要密码。请用动态码或一枚恢复码确认 —— 只凭密码不能关闭。 | Afterwards only the password is needed to sign in. Confirm with a code from your authenticator or one recovery code — the password alone cannot turn it off. |
| `mfa.manage.turn_off_failed` | 没能关闭，请检查动态码或恢复码 | Could not turn it off — check the code |
| `profile.mfa_must_setup` | 你的角色要求开启两步验证。开启后才能继续使用。 | Your role requires two-step verification. Turn it on to carry on. |
| `soul_app.mfa.disable.use_recovery` | 手机不在身边？改用恢复码 | Phone not with you? Use a recovery code |
| `permissions.members.tabs` | 角色页签 | Role tabs |
| `permissions.members.tab_details` | 详情 | Details |
| `permissions.members.search` | 搜索成员 | Search members |
| `permissions.members.list` | 持有此角色的人 | People holding this role |
| `permissions.members.empty` | 没有人持有此角色。 | Nobody holds this role. |
| `permissions.members.load_error` | 成员加载失败 | Could not load the members |
| `permissions.members.primary` | 主角色 | Main role |
| `permissions.members.extra` | 兼任 | Additional |
| `permissions.members.primary_locked` | 主角色不能在这里移除：先给此人授别的主角色。 | A main role cannot be removed here: give this person another main role first. |
| `permissions.members.remove` | 移除 | Remove |
| `permissions.members.remove_label` | 移除 {{name}} 的兼任 | Remove {{name}}'s additional role |
| `permissions.members.grant` | 批量授予 | Grant to people |
| `permissions.members.grant_n` | 授予 {{n}} 人 | Grant to {{n}} |
| `permissions.members.pick_search` | 按用户名或邮箱找人 | Find people by username or email |
| `permissions.members.pick_empty` | 没有匹配的人 | Nobody matches |
| `permissions.members.already` | 已持有 | Already holds it |
| `permissions.members.kind` | 授为 | Grant as |
| `permissions.members.primary_hint` | 授为主角色会替换此人原来的主角色。 | Granting it as the main role replaces the person's current main role. |
| `permissions.members.granted` | 已授予 {{n}} 人 · 对方刷新页面后生效 | Granted to {{n}} · takes effect for them when they reload |
| `permissions.members.removed` | 已移除 {{n}} 人 · 对方刷新页面后生效 | Removed from {{n}} · takes effect for them when they reload |
| `permissions.members.change_error` | 没有改成，请重试 | The change did not go through; try again |
| `permissions.members.refused_title` | 这一批没有改动：下面这些人被拒绝。 | Nothing in this batch was changed; these people were refused: |
| `permissions.members.refused.not_found` | 不在你能管理的范围内 | not someone you can manage |
| `permissions.members.refused.primary_needs_replacement` | 主角色不能直接移除，先授别的主角色 | a main role cannot be removed; give another main role first |
| `permissions.members.refused.forbidden` | 不能授予比你自己更高的角色 | you cannot grant a role above your own |
| `permissions.members.refused.invalid` | 这个角色不能这样授予 | this role cannot be granted that way |
| `permissions.matrix.category_all` | 全选 | All |
| `permissions.matrix.category_none` | 全不选 | None |
| `permissions.matrix.category_all_label` | {{role}} 勾选「{{category}}」类的全部权限 | Grant {{role}} every {{category}} permission |
| `permissions.matrix.category_none_label` | {{role}} 取消「{{category}}」类的全部权限 | Revoke every {{category}} permission from {{role}} |
| `permissions.matrix.saved_all_refresh` | 已保存 {{n}} 项 · 对方刷新页面后生效 | Saved {{n}} · takes effect for others when they reload |
| `users.org_filter.label` | 按机构筛选（含下级） | Filter by organization (with sub-units) |
| `users.org_filter.all` | 全部机构 | All organizations |
| `users.status_filter.all` | 全部状态 | Any status |
| `social_moderation.words.copy_target` | 复制到 | Copy into |
| `social_moderation.words.copy_target_placeholder` | 选择目标文明 | Choose the target civilization |
| `acceptInvite.reset_invalid_body` | 链接已过期或已用过。请联系管理员再重置一次。 | It has expired or was already used. Ask your administrator to reset your password again. |
| `acceptInvite.reset_invalid_title` | 这个链接用不了 | This link can't be used |
| `acceptInvite.reset_link_note` | 链接 24 小时内有效，只能用一次。 | This link lasts 24 hours and works once. |
| `acceptInvite.reset_subtitle` | 管理员重置了你的密码。在这里设一个新密码，然后用用户名和它登录。 | An administrator reset your password. Set a new one here, then sign in with your username and it. |
| `users.reset_password.confirm_body_link` | 旧密码立即作废，此人所有已登录的设备都会退出。你会拿到一条 24 小时内有效、只能用一次的链接，由本人在上面自己设新密码；包括你在内，谁都看不到新密码。 | The old password stops working at once and every device this person is signed in on is signed out. You get a one-time link, valid for 24 hours, on which they set a new password themselves. Nobody, you included, ever sees the new password. |
| `users.reset_password.link_close` | 关闭 | Close |
| `users.reset_password.link_copy` | 复制链接 | Copy link |
| `users.reset_password.link_title` | {{name}} 的设置密码链接 | Set-password link for {{name}} |
| `users.reset_password.link_warning` | 请亲自把链接交给本人。链接只能用一次，{{hours}} 小时后失效；再重置一次会换一条新的。 | Pass this link to them yourself. It works once and expires in {{hours}} hours; resetting again replaces it. |
| `users.second_factor.admin_target_global_only` | 只有全局管理员能对另一位管理员这样操作。 | Only the global administrator can do this to another administrator. |
| `users.second_factor.body` | {{name}} 是管理员。对另一位管理员操作，需要输入你自己的两步验证码。 | {{name}} is an administrator. Acting on another administrator needs your own two-step verification code. |
| `users.second_factor.code_label` | 6 位动态码 | 6-digit code |
| `users.second_factor.expired` | 验证码已过期，请等下一个。 | That code has expired. Wait for the next one. |
| `users.second_factor.locked` | 两步验证已锁定，请 {{minutes}} 分钟后再试。 | Two-step verification is locked. Try again in {{minutes}} minutes. |
| `users.second_factor.recovery_label` | 恢复码 | Recovery code |
| `users.second_factor.second_factor_unavailable` | 请先给自己的账号开启两步验证。 | Turn on two-step verification on your own account first. |
| `users.second_factor.submit` | 确认 | Confirm |
| `users.second_factor.title` | 用你的两步验证码确认 | Confirm with your two-step code |
| `users.second_factor.use_recovery` | 改用恢复码 | Use a recovery code instead |
| `users.second_factor.use_totp` | 改用 6 位动态码 | Use the 6-digit code instead |
| `users.second_factor.wrong` | 验证码不对，再错 {{n}} 次将锁定。 | That code is not right. {{n}} tries left before it locks. |
| `state.gone_title` | 无权查看或已不存在 | No access, or it no longer exists |
| `ledger.journal.totals_whole_hall` | 合计为全殿;明细只列你数据范围内的灵魂 | Totals cover the whole hall; the entries list only souls in your data scope |
