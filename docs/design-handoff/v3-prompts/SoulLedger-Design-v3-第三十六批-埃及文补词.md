# 第三十六批 · 埃及文补词(2026-10-16)

这一轮做了 P3 里不需要新画稿的几件事，zh-Hans / en 已写好，请给 egy。`{{…}}` 原样保留。共 49 条新词，另有 2 条旧词请改写。

## 一、这些文案出现在哪

- **死亡同步重试(W-12)**:只有「系统内部错误」的失败能重试，其余失败只显示原因与已重试次数。`death_sync.error.*` 是五种失败原因的名字(徽章上用)。重试仍失败时，本租户管理员会收到一条站内通知(`official_notify.death_sync_retry_failed.*`)。
- **重算功过(W-10)**:灵魂详情页头的按钮、确认句与结果提示(`souls.detail.recalculate*`)。
- **改显示名(O-16)**:网页个人资料多了「显示名」一行;官员 App 改名页的空值提示。
- **审核结果推送(G5)**:殿司隐藏 / 删除 / 通过 / 恢复灵魂的帖子或评论时推给作者(`soul_push.content_*`)。隐藏与删除时官员必须从预设理由里选一条(复用举报理由的现有词条，不用新给),带理由的推送用 `*_reason` 那一组,`{{reason}}` 是理由名或官员写的「其他」原文。
- **审阅页的理由选择**:`social_moderation.review.mod_reason_*` 与 `other_note_*`。

## 二、请改写的 2 条旧词

审阅页原来的文本框以前是「隐藏与警告必填的处理理由」,现在隐藏 / 删除改为选预设理由，这个框只剩「处理备注，警告时必填」。zh / en 已改，现有 egy 的意思过时了:

| key | zh(新) | en(新) | egy(现有，请改) |
|---|---|---|---|
| social_moderation.review.reason_label | 处理备注（警告必填） | Note (required to warn) | Khet (Imen, Hab: Sesen) |
| social_moderation.review.reason_required | 警告必须写理由 | Warning needs a reason | Imen, Hab: Khet Sesen |

## 三、全部新词

| key | zh | en |
|---|---|---|
| death_sync.error.INTERNAL_ERROR | 系统内部错误 | Internal error |
| death_sync.error.INVALID_TRANSITION | 状态不允许转入审判 | State does not allow judgment |
| death_sync.error.SOUL_NOT_ALIVE | 灵魂已不在阳世 | Soul is no longer alive |
| death_sync.error.SOUL_NOT_FOUND | 查无此魂 | No matching soul |
| death_sync.error.VALIDATION_ERROR | 登记内容不合格式 | Invalid registration data |
| death_sync.retry.action | 重试 | Retry |
| death_sync.retry.confirm_message | 按原始登记内容再处理一次。成功后灵魂转入审判。 | Runs the original registration once more. On success the soul goes to judgment. |
| death_sync.retry.confirm_title | 重新处理这条登记？ | Process this registration again? |
| death_sync.retry.count | 已重试 {{count}}/{{max}} 次 | Retried {{count}}/{{max}} |
| death_sync.retry.done | 已重新处理，灵魂已转入审判 | Processed; the soul is now in judgment |
| death_sync.retry.refused | 这条登记现在不能重试，列表已刷新 | This registration can no longer be retried; list refreshed |
| death_sync.retry.still_failed | 重试后仍失败：{{reason}} | Still failed after retry: {{reason}} |
| officer_app.me.name_empty | 姓名不能为空 | Name can't be empty |
| official_notify.death_sync_retry_failed.body | 死亡登记 {{reference}} 第 {{count}} 次重试仍失败（{{reason}}），请到死亡同步页查看。 | Retry {{count}} of death registration {{reference}} failed again ({{reason}}). See the Death Sync page. |
| official_notify.death_sync_retry_failed.title | 死亡登记重试仍失败 | Death registration retry failed |
| profile.display_name | 显示名 | Display name |
| social_moderation.review.mod_reason_label | 隐藏 / 删除理由（会告诉作者） | Reason to hide or delete (the author is told) |
| social_moderation.review.mod_reason_placeholder | 选择理由 | Choose a reason |
| social_moderation.review.mod_reason_required | 隐藏或删除须先选理由 | Choose a reason to hide or delete |
| social_moderation.review.other_note_label | 其他理由 | Other reason |
| social_moderation.review.other_note_required | 选「其他」须写明理由 | Write the reason for “Other” |
| soul_push.content_approved_comment.body | 你的评论已通过审核，大家都看得到了。 | Your comment passed review and is now visible to everyone. |
| soul_push.content_approved_comment.title | 评论已通过审核 | Your comment was approved |
| soul_push.content_approved_post.body | 你的帖子已通过审核，大家都看得到了。 | Your post passed review and is now visible to everyone. |
| soul_push.content_approved_post.title | 帖子已通过审核 | Your post was approved |
| soul_push.content_deleted_comment.body | 你的评论被殿司删除。 | An officer deleted your comment. |
| soul_push.content_deleted_comment.title | 评论已被删除 | Your comment was deleted |
| soul_push.content_deleted_comment_reason.body | 你的评论被殿司删除：{{reason}} | An officer deleted your comment: {{reason}} |
| soul_push.content_deleted_comment_reason.title | 评论已被删除 | Your comment was deleted |
| soul_push.content_deleted_post.body | 你的帖子被殿司删除。 | An officer deleted your post. |
| soul_push.content_deleted_post.title | 帖子已被删除 | Your post was deleted |
| soul_push.content_deleted_post_reason.body | 你的帖子被殿司删除：{{reason}} | An officer deleted your post: {{reason}} |
| soul_push.content_deleted_post_reason.title | 帖子已被删除 | Your post was deleted |
| soul_push.content_hidden_comment.body | 你的评论被殿司隐藏，打开灵魂簿查看。 | An officer hid your comment. Open Soul Ledger to see it. |
| soul_push.content_hidden_comment.title | 评论已被隐藏 | Your comment was hidden |
| soul_push.content_hidden_comment_reason.body | 你的评论被殿司隐藏：{{reason}} | An officer hid your comment: {{reason}} |
| soul_push.content_hidden_comment_reason.title | 评论已被隐藏 | Your comment was hidden |
| soul_push.content_hidden_post.body | 你的帖子被殿司隐藏，打开灵魂簿查看。 | An officer hid your post. Open Soul Ledger to see it. |
| soul_push.content_hidden_post.title | 帖子已被隐藏 | Your post was hidden |
| soul_push.content_hidden_post_reason.body | 你的帖子被殿司隐藏：{{reason}} | An officer hid your post: {{reason}} |
| soul_push.content_hidden_post_reason.title | 帖子已被隐藏 | Your post was hidden |
| soul_push.content_restored_comment.body | 你的评论已恢复显示。 | Your comment is visible again. |
| soul_push.content_restored_comment.title | 评论已恢复 | Your comment was restored |
| soul_push.content_restored_post.body | 你的帖子已恢复显示。 | Your post is visible again. |
| soul_push.content_restored_post.title | 帖子已恢复 | Your post was restored |
| souls.detail.recalculate | 重算功过 | Recalculate |
| souls.detail.recalculate_confirm | 按全部事项重算 {{name}} 的功与过？ | Recalculate {{name}}'s merit and demerit from all records? |
| souls.detail.recalculate_failed | 重算失败，请稍后再试 | Recalculation failed. Try again later. |
| souls.detail.recalculate_success | 功过已重算 | Merit and demerit recalculated |
