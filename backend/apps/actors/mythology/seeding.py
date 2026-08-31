"""The seeding mechanism: upsert semantics, per-table passes, run tally.

Everything here is about *how* rows are written and nothing about *what*
they say — the corpora are the sibling modules, and the provenance contract
between them is in ``apps.actors.mythology``. ``MythologySeeder`` is mixed
into the ``Command`` in
``apps/actors/management/commands/seed_mythology.py``, which stays the entry
point Django discovers.

Moved verbatim out of ``seed_mythology.py``.
"""
from apps.actors.models import ALIASES_KEY, Actor, ActorRole
from apps.actors.mythology import TENANTS
from apps.actors.mythology.actors_egyptian import (
    ASSESSOR_PAPYRUS,
    ASSESSOR_REALM_CODE,
    ASSESSOR_SOURCE_EDITION,
)
from apps.actors.mythology.realms import REALM_PARENTS
from apps.actors.mythology.statutes_egyptian import (
    NEGATIVE_CONFESSION_FIELD,
    NEGATIVE_CONFESSION_SOURCE,
)
from apps.judgment.models import Statute
from apps.realms.models import Realm
from apps.souls.models import CIVILIZATION_TENANT
from apps.tenants.models import Tenant

REALM_FIELDS = (
    "name_local", "name_zh", "name_en", "name_egy", "realm_type", "tier",
    "description", "memory_reset_mechanism", "is_eternal", "cycle_limit",
)
ACTOR_FIELDS = (
    "name_zh", "name_en", "name_egy", "role", "realm",
    "title", "title_zh", "title_en", "title_egy", "description",
    # `is_active` 在比对集合里,因为有两处真实消费方读它(2026-08-30 全仓核实):
    #   apps/actors/views.py:31                       queryset = filter(is_active=True)
    #   .../commands/migrate_actors_to_users.py:152   is_active=actor.is_active
    # 一个 `is_active=False` 的种子行,会让 Actor 接口**返回空**,并且在
    # Actor→User 迁移里产出一个**被停用的用户账号**。
    #
    # 它此前既不在 values 里也不在这个元组里,于是 `--update` 修不了它,变异测试
    # 也看不见它:往 values 注入 `"is_active": False`,13 个作用域测试文件
    # **92 passed,0 红**。
    #
    # (审计账本 H45 还写了「`apps/workflow/services.py:704` 的审批人解析同样过滤
    # 它」——**那一句是错的**。704 行过滤的是 `WorkflowTemplate.is_active`,而
    # `_resolve_approver` 用 `Actor._base_manager.filter(civilization, tenant_id,
    # is_deleted=False)`,根本不看 `is_active`。行号对、字段名对、模型不对。)
    "is_active",
    # `powers_json` is in the comparison set for ordinary actors too, because
    # it is where a row's recorded aliases live (see EGYPTIAN_ACTOR_ALIASES) and
    # an actor whose set of names changed is a changed row. It was previously
    # compared for assessors only, which meant `--update` could not have
    # propagated an alias edit to an existing database.
    "powers_json",
)
# Assessors carry the same columns; their `powers_json` additionally holds
# assessor_index, home_place and the confession clause, and an assessor whose
# index or citation drifted is a changed row that `--update` has to see.
ASSESSOR_FIELDS = ACTOR_FIELDS
# `source` and `source_notes` are in the comparison set deliberately: an
# article whose provenance changed is a changed article, and provenance is the
# part of a statute this feature exists to keep honest.
STATUTE_FIELDS = (
    "civilization", "corpus", "ordinal", "polarity",
    "title_zh", "title_en", "title_egy", "text_zh", "text_en", "text_egy",
    "source", "source_notes", "payload_json",
    "source_actor", "source_actor_field",
)

#: Columns this seeder deliberately does not own, and why.
#:
#: `--update` compares only the `*_FIELDS` tuples above, so anything outside
#: them **drifts invisibly**: the seeder reports `unchanged` for a row whose
#: uncompared column somebody edited, and the ordinary (non-`--update`) run
#: prints nothing at all about it. Measured 2026-08-29: set an actor's
#: `icon_url` by hand, run `--update`, and every compared field is restored
#: while `icon_url` stays — reported as `unchanged`.
#:
#: The fix for `is_active` was to bring it *into* the comparison set (it has
#: real consumers — see the comment in `ACTOR_FIELDS`). These three are the
#: opposite call, written down rather than left as an omission that looks the
#: same either way:
#:
#: * `Actor.icon_url` — operational. Nothing in `ACTORS`/`ASSESSORS` supplies
#:   an icon; a deployment that sets one is not drifting from the corpus.
#: * `Actor.is_deleted` / soft-delete columns — retirement is
#:   `actors/0010`'s job and `seed_mythology` must not undo it.
#: * `Realm.is_judgment_required` — **migration-managed**. `realms/0013` sets
#:   it to False for specific realms and `realms/0014`'s docstring says it is
#:   "deliberately not set here"; folding it into the seed table would make
#:   the next `--update` revert those migrations.
#:
#: `tests/test_seed_field_coverage_is_declared.py` requires every concrete
#: field on these models to be in one list or the other, so a column added
#: later cannot land in neither.
NOT_SEEDED = {
    "Actor": {"icon_url"},
    "Realm": {"is_judgment_required"},
}

#: Columns every model here carries for reasons that have nothing to do with
#: the corpus: identity, the audit stamps `AuditUserFields` adds, the
#: soft-delete columns, the tenant/civilization the seeder derives itself, and
#: `sort_code`. Listed once rather than repeated per model.
INFRASTRUCTURE_FIELDS = frozenset({
    "id",
    "create_time", "create_user", "update_time", "update_user", "version",
    "created_at",
    "is_deleted", "deleted_at", "deleted_by", "delete_reason",
    "delete_cascade_id",
    "tenant", "civilization",
    "sort_code",
    # The identity a row is matched on — see `_seed_actors`/`_seed_realms`.
    # It cannot be "updated" because it is how the row is found.
    "name", "realm_code", "code",
    "parent_realm",
})


class Stats:
    """Per-model tally, printed as the run summary."""

    def __init__(self, label):
        self.label = label
        self.created = 0
        self.updated = 0
        self.unchanged = 0
        self.skipped = 0

    def line(self):
        return (
            f"{self.label:<8} created={self.created:<4} updated={self.updated:<4} "
            f"unchanged={self.unchanged:<4} skipped={self.skipped}"
        )


class MythologySeeder:
    """The write path, split out of `Command` so the data tables can be too.

    Mixed into the management command rather than instantiated: every method
    reports through ``self.stdout``/``self.style``, which are BaseCommand's.
    """

    # ------------------------------------------------------------------
    # Tenants
    # ------------------------------------------------------------------
    def _seed_tenant(self, civilization, stats):
        code = CIVILIZATION_TENANT[civilization]
        tenant = Tenant.objects.filter(code=code).first()
        if tenant is not None:
            stats.unchanged += 1
            return tenant

        self.stdout.write(f"  + Tenant {code}")
        stats.created += 1
        # Written even in dry-run: the whole run is one transaction that gets
        # rolled back at the end, and writing means a dry-run against an empty
        # database resolves realm FKs and reports the same plan a real run
        # would take, rather than a cascade of "unknown realm" warnings.
        return Tenant.objects.create(
            code=code, display_name=TENANTS[code], dispatch_enabled=True
        )

    # ------------------------------------------------------------------
    # Realms
    # ------------------------------------------------------------------
    def _seed_realms(self, civilization, tenant, rows, do_update, stats):
        for row in rows:
            (realm_code, name_local, name_zh, name_en, name_egy, realm_type, tier,
             description, memory_reset, is_eternal, cycle_limit) = row
            values = {
                "civilization": civilization,
                "name_local": name_local,
                "name_zh": name_zh,
                "name_en": name_en,
                "name_egy": name_egy,
                "realm_type": realm_type,
                "tier": tier,
                "description": description,
                "memory_reset_mechanism": memory_reset,
                "is_eternal": is_eternal,
                "cycle_limit": cycle_limit,
            }
            self._upsert(
                model=Realm,
                lookup={"realm_code": realm_code},
                values=values,
                compare_fields=("civilization", *REALM_FIELDS),
                tenant=tenant,
                identity=f"Realm {realm_code}",
                do_update=do_update,
                stats=stats,
            )
        self._link_realm_parents(civilization, rows, do_update, stats)

    def _link_realm_parents(self, civilization, rows, do_update, stats):
        """Attach the realms in REALM_PARENTS to the realm they are part of.

        A second pass rather than a column in `values`: the parent has to exist
        before the child can point at it, and both are rows in the same table
        this loop is still writing. Running afterwards means the order of the
        seed table cannot decide whether the link resolves.

        Filling in a NULL parent happens regardless of `--update`, for the same
        reason `_upsert` fills in a NULL tenant regardless: an unset structural
        link is not somebody's decision being overwritten, it is a row that has
        not been told what it belongs to yet. Repointing a parent that is
        already set to something else IS a decision, and that needs --update.
        """
        codes = {row[0] for row in rows}
        by_code = {
            realm.realm_code: realm
            for realm in Realm.all_objects.filter(civilization=civilization)
        }
        for child_code, parent_code in REALM_PARENTS.items():
            if child_code not in codes:
                continue
            child = by_code.get(child_code)
            parent = by_code.get(parent_code)
            if child is None or parent is None:
                missing = child_code if child is None else parent_code
                self.stdout.write(self.style.ERROR(
                    f"  [warn] Realm {child_code} belongs under {parent_code} and "
                    f"{missing} is not in the database — left unlinked"
                ))
                continue
            if child.is_deleted:
                # Same rule as _upsert: a retired row is reported by that pass
                # and otherwise left exactly as it is.
                continue
            if child.parent_realm_id == parent.id:
                continue
            if child.parent_realm_id is None or do_update:
                self.stdout.write(f"  ~ Realm {child_code}: parent_realm -> {parent_code}")
                stats.updated += 1
                child.parent_realm = parent
                child.save()
                continue
            self.stdout.write(
                f"  = Realm {child_code}: sits under "
                f"{child.parent_realm.realm_code} rather than {parent_code} — "
                f"left as-is (pass --update to overwrite)"
            )

    # ------------------------------------------------------------------
    # Actors
    # ------------------------------------------------------------------
    def _seed_actors(self, civilization, tenant, rows, do_update, stats, aliases=None):
        """Seed one civilization's principals.

        `aliases` is `{Actor.name: [other written forms]}` — the correspondence
        between two spellings of one being, recorded rather than inferred. See
        the header of EGYPTIAN_ACTOR_ALIASES for why it lives in `powers_json`
        and not in a fifth name column, and `WorkflowService._resolve_approver`
        for who reads it back.
        """
        aliases = aliases or {}

        # An alias table naming a row this cast does not have is a typo that
        # would otherwise be silent: the alias is simply never written, and the
        # lookup that was supposed to use it falls through to the behaviour it
        # was meant to replace. Say so rather than seeding around it.
        unknown = sorted(set(aliases) - {row[0] for row in rows})
        if unknown:
            self.stdout.write(self.style.ERROR(
                f"  [warn] alias table names actor(s) not in this cast: "
                f"{unknown} — those aliases are not seeded"
            ))

        # Realm FKs are resolved by code against whatever is in the DB now —
        # including the realms this same run just wrote inside this transaction.
        realm_by_code = {r.realm_code: r for r in Realm.all_objects.filter(civilization=civilization)}

        for row in rows:
            (name, name_zh, name_en, name_egy, role, realm_code,
             title, title_zh, title_en, title_egy, description) = row
            realm = realm_by_code.get(realm_code)
            if realm is None:
                self.stdout.write(self.style.ERROR(
                    f"  [warn] Actor {name!r} references unknown realm {realm_code!r} — "
                    f"seeding with realm=None"
                ))
            values = {
                "name_zh": name_zh,
                "name_en": name_en,
                "name_egy": name_egy,
                "role": role,
                "realm": realm,
                "title": title,
                "title_zh": title_zh,
                "title_en": title_en,
                "title_egy": title_egy,
                "description": description,
                # `{}` and not "leave whatever is there" for an actor with no
                # aliases: `powers_json` is compared field-wise, so a value has
                # to be supplied for every row or an aliasless actor would
                # compare its `{}` against a missing key and read as changed on
                # every run. `{}` is also the model default, so a freshly
                # seeded database and a migrated one agree.
                "powers_json": (
                    {ALIASES_KEY: list(aliases[name])} if name in aliases else {}
                ),
                # 显式写出来,而不是靠模型默认值。默认值只在**创建**时生效:
                # 一个此前被停用的行,`--update` 不会把它启用回来,除非这个字段
                # 既在 values 里、又在 compare_fields 里。种子行的定义是「这个
                # 语料声明存在的角色」,而语料里没有「已退役」这个概念 ——
                # 退役走的是 `actors/0010` 那种显式迁移,不是种子命令。
                "is_active": True,
            }
            self._upsert(
                model=Actor,
                lookup={"name": name, "civilization": civilization},
                values=values,
                compare_fields=ACTOR_FIELDS,
                tenant=tenant,
                identity=f"Actor {name}",
                do_update=do_update,
                stats=stats,
            )

    # ------------------------------------------------------------------
    # The Forty-Two Assessors
    # ------------------------------------------------------------------
    def _seed_assessors(self, civilization, tenant, rows, do_update, stats):
        """Seed the bench of 42 through the same upsert as everything else.

        Separate from `_seed_actors` only because the rows carry three values
        Actor has no column for (position in the bench, home town, confession
        clause) and they go into `powers_json`. Idempotency, tenant assignment,
        soft-delete handling and dry-run all come from `_upsert` unchanged.
        """
        realm = Realm.all_objects.filter(
            civilization=civilization, realm_code=ASSESSOR_REALM_CODE
        ).first()
        if realm is None:
            self.stdout.write(self.style.ERROR(
                f"  [warn] The Forty-Two reference unknown realm "
                f"{ASSESSOR_REALM_CODE!r} — seeding with realm=None"
            ))

        for row in rows:
            index = row["index"]
            powers = {
                "assessor_index": index,
                "home_place": row["home_place"],
                "negative_confession": row["denies"],
                "source_edition": ASSESSOR_SOURCE_EDITION,
                "papyrus": ASSESSOR_PAPYRUS,
            }
            if row.get("notes"):
                # Verbatim source caveats. Present only where the source is
                # actually uncertain, so an empty key never reads as "checked".
                powers["source_notes"] = list(row["notes"])

            title = f"Assessor {index} of the Forty-Two"
            values = {
                # name_zh stays empty on purpose — see the table's header.
                "name_zh": "",
                "name_en": row["name"],
                "name_egy": row["name"],
                "role": ActorRole.JUDGE,
                "realm": realm,
                "title": title,
                "title_zh": f"四十二判官之第{index}位",
                "title_en": title,
                "title_egy": "",
                "description": self._assessor_description(row),
                "powers_json": powers,
                # 与 `_seed_actors` 同一个理由(见那里的注释)。这一行是补上的:
                # `is_active` 被加进 `ACTOR_FIELDS` 时,`ASSESSOR_FIELDS` 是它的
                # 别名,于是比对集合立刻包含了这个字段,而这里的 values 没有 ——
                # `--update` 因此把 **44 个判官行**全部判成「有改动」,拿 None 去
                # 比 True。dry-run 里看得见:`~ Assessor 34 Nefer-Tem: is_active`,
                # 一路到 42。
                #
                # 后果不是数据被写坏(值本来就是 True),是**汇总说谎**:
                # `updated=44 unchanged=43` 会让人以为这一轮真的改了 44 行,
                # 而实际只有一行有内容差异。**一个把「无差异」报成「已更新」的
                # 命令,会让下一次真正的差异淹没在噪音里。**
                "is_active": True,
            }
            self._upsert(
                model=Actor,
                lookup={"name": row["name"], "civilization": civilization},
                values=values,
                compare_fields=ASSESSOR_FIELDS,
                tenant=tenant,
                identity=f"Assessor {index:02d} {row['name']}",
                do_update=do_update,
                stats=stats,
            )

    # ------------------------------------------------------------------
    # Statutes
    # ------------------------------------------------------------------
    def _seed_statutes(self, civilization, tenant, corpus, source, rows, do_update, stats):
        """Seed one corpus transcribed from a document into CIVILIZATION_STATUTES.

        Six corpora are transcribed today: the seven capital sins on the
        terraces of Purgatorio (EUROPEAN_STATUTES), 《太微仙君功過格》
        (CHINESE_STATUTES) and the circles of the Inferno (INFERNO_STATUTES).
        Called once per corpus, so a civilization with two of them — Europe has
        two, and they are separate structures — seeds both. This path was kept
        alive while CIVILIZATION_STATUTES was empty — the withdrawal removed two
        fabricated tables, not the ability to seed a real one — and
        tests/test_judgment_statutes.py still calls it directly with a throwaway
        row, which is what the next corpus (功過格, if it verifies) will arrive
        through.

        Matched on `code`, which is why real codes should be stable and
        mnemonic rather than generated: a citation recorded against an article
        has to survive a re-seed, and a re-numbering would silently repoint
        every judgment that cited it.

        `code` alone, not `(tenant, code)` — the same shape realms use with
        `realm_code`. The uniqueness constraint on the model is per-tenant, but
        every code here is civilization-prefixed and so globally unique in
        practice; matching on the pair would also collide with `_upsert`'s own
        `tenant=` argument. If two tenants ever did share a code, `_upsert`
        reports the ambiguity and skips rather than picking one.
        """
        for row in rows:
            values = {
                "civilization": civilization,
                "corpus": corpus,
                "ordinal": row["ordinal"],
                "polarity": row["polarity"],
                "title_zh": row["title_zh"],
                "title_en": row["title_en"],
                "title_egy": "",
                "text_zh": row["text_zh"],
                "text_en": row["text_en"],
                "text_egy": "",
                "source": source,
                "source_notes": list(row.get("notes", ())),
                "payload_json": dict(row.get("payload", {})),
                "source_actor": None,
                "source_actor_field": "",
            }
            self._upsert(
                model=Statute,
                lookup={"code": row["code"]},
                values=values,
                compare_fields=STATUTE_FIELDS,
                tenant=tenant,
                identity=f"Statute {row['code']}",
                do_update=do_update,
                stats=stats,
            )

    def _seed_derived_statutes(self, civilization, tenant, do_update, stats):
        """Give each of the Forty-Two a citable article — by reference, not by copy.

        The clause itself is never written here. Each row records WHICH actor
        it derives from and WHICH key of that actor's `powers_json` holds the
        text; `Statute.derived_text` reads it back. Correct an assessor's
        confession clause and every judgment that cited it reads the corrected
        text, because there is only ever one copy of it.

        The assessors are found by inspecting `powers_json` in Python rather
        than with a `powers_json__has_key` lookup. JSON key lookups are backend
        -specific and this command runs against SQLite locally and PostgreSQL
        in Docker/CI; fifty-odd Egyptian actors is not a query worth risking a
        backend disagreement over.
        """
        assessors = [
            actor
            for actor in Actor.all_objects.filter(civilization=civilization, is_deleted=False)
            if isinstance(actor.powers_json, dict)
            and actor.powers_json.get("assessor_index") is not None
        ]
        if not assessors:
            # Not silent: an empty derivation means the assessor seed did not
            # run or was skipped, and a corpus that quietly seeds zero articles
            # is exactly the vacuous-success this file's tests guard against.
            self.stdout.write(self.style.ERROR(
                "  [warn] No assessors carry an assessor_index — the Egyptian "
                "statute corpus derives from them and will be empty."
            ))
            return

        assessors.sort(key=lambda actor: actor.powers_json["assessor_index"])
        for actor in assessors:
            index = actor.powers_json["assessor_index"]
            clause = actor.powers_json.get(NEGATIVE_CONFESSION_FIELD) or ""
            if not clause:
                self.stdout.write(self.style.ERROR(
                    f"  [warn] Assessor {index} ({actor.name}) has no "
                    f"{NEGATIVE_CONFESSION_FIELD!r} — deriving an article with "
                    f"no text."
                ))
            values = {
                "civilization": civilization,
                "corpus": "NEGATIVE_CONFESSION",
                "ordinal": index,
                # A denial, not a prohibition. See StatutePolarity.
                "polarity": "DENIAL",
                # The title is the assessor before whom the denial is made; the
                # body is the denial, and the body is NOT stored.
                "title_zh": "",
                "title_en": actor.name,
                "title_egy": actor.name_egy or actor.name,
                "text_zh": "",
                "text_en": "",
                "text_egy": "",
                "source": NEGATIVE_CONFESSION_SOURCE,
                "source_notes": [],
                "payload_json": {"assessor_index": index},
                "source_actor": actor,
                "source_actor_field": NEGATIVE_CONFESSION_FIELD,
            }
            self._upsert(
                model=Statute,
                lookup={"code": f"EG-NC-{index:02d}"},
                values=values,
                compare_fields=STATUTE_FIELDS,
                tenant=tenant,
                identity=f"Statute EG-NC-{index:02d} ({actor.name})",
                do_update=do_update,
                stats=stats,
            )

    @staticmethod
    def _assessor_description(row):
        parts = [
            f"Assessor {row['index']} of the Forty-Two of Ma'at, "
            f"Book of the Dead chapter 125."
        ]
        if row["meaning"]:
            parts.append(f"Budge glosses the name as \"{row['meaning']}\".")
        if row["home_place"]:
            parts.append(f"Comes forth from {row['home_place']}.")
        else:
            parts.append("The text gives no home place for this one.")
        parts.append(f"Denies {row['denies']}.")
        parts.append(f"Papyrus of {ASSESSOR_PAPYRUS}. {ASSESSOR_SOURCE_EDITION}")
        for note in row.get("notes", ()):
            parts.append(f"Note: {note}")
        return " ".join(parts)

    # ------------------------------------------------------------------
    # Shared upsert
    # ------------------------------------------------------------------
    def _upsert(self, *, model, lookup, values, compare_fields, tenant, identity,
                do_update, stats):
        """Create-or-reconcile one row, keyed on `lookup`.

        `all_objects` rather than `objects`, so a soft-deleted row is *seen*
        (and deliberately left alone) instead of being invisible and then
        colliding with the unique constraint on insert.
        """
        existing = list(model.all_objects.filter(**lookup))
        alive = [obj for obj in existing if not obj.is_deleted]

        if len(alive) > 1:
            # Duplicate rows predate this command (see fix_actor_civilization).
            # Reconciling them is that command's job; say so and move on.
            self.stdout.write(self.style.ERROR(
                f"  [warn] {identity}: {len(alive)} live rows match {lookup} — "
                f"ambiguous, skipping. Run `manage.py fix_actor_civilization` to dedupe."
            ))
            stats.skipped += 1
            return

        if not alive:
            if existing:
                self.stdout.write(
                    f"  [skip] {identity}: only soft-deleted row(s) match — not resurrecting "
                    f"(reason: {existing[0].delete_reason or 'none recorded'})"
                )
                stats.skipped += 1
                return
            self.stdout.write(f"  + {identity}")
            stats.created += 1
            model.all_objects.create(**lookup, **values, tenant=tenant)
            return

        obj = alive[0]
        changed = [
            field for field in (*compare_fields, "tenant")
            if getattr(obj, field, None) != (tenant if field == "tenant" else values.get(field))
        ]
        # A row seeded before tenants were assigned has tenant=None; filling
        # that in is not an edit to the mythology, it is the row finally becoming
        # visible to the tenant that owns it, so it happens regardless of
        # --update.
        tenant_only = changed == ["tenant"]

        if not changed:
            stats.unchanged += 1
            return

        if do_update or tenant_only:
            what = "tenant" if tenant_only else ", ".join(changed)
            self.stdout.write(f"  ~ {identity}: {what}")
            stats.updated += 1
            if do_update:
                for field, value in values.items():
                    setattr(obj, field, value)
            obj.tenant = tenant
            obj.save()
            return

        self.stdout.write(
            f"  = {identity}: exists, differs on [{', '.join(changed)}] — "
            f"left as-is (pass --update to overwrite)"
        )
        stats.unchanged += 1
