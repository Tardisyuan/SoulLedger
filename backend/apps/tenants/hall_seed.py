"""A hall the global admin creates starts from its civilization's seed, not empty (docs-others X-1).

User decision 2026-10-27: realms, the cast (actors, which the seeded templates name as approvers), statutes and
the formal workflow templates are copied into the new hall; officers are still added by the admin. Before this a
new hall had no realms (every disposition's destination came out None), no approvers and the one-node generic
flow. Same rows ``seed_mythology`` and ``seed_workflow_templates`` write for the four seeded halls, confined to
the new hall (``MythologySeeder.hall``) because realm codes, statute codes and actor names repeat per hall.
"""
import io


def seed_hall(tenant) -> None:
    """Seed ``tenant`` from its civilization. Call inside the transaction that created it."""
    from apps.actors.management.commands.seed_mythology import Command as MythologyCommand
    from apps.actors.mythology import CIVILIZATION_DATA
    from apps.actors.mythology.seeding import Stats
    from apps.workflow.management.commands.seed_workflow_templates import Command as TemplateCommand
    from apps.workflow.templates import FAIL_ROUTES, seed_template

    civilization = tenant.civilization
    label = next((key for key, data in CIVILIZATION_DATA.items() if data[0] == civilization), None)
    if label is None:
        return
    seeder = MythologyCommand(stdout=io.StringIO())
    seeder.hall = tenant
    seeder._seed_civilization(label, tenant, False, Stats("realms"), Stats("actors"), Stats("statutes"))

    templates = TemplateCommand(stdout=io.StringIO())
    for pair_civilization, case_type in FAIL_ROUTES:
        if pair_civilization == civilization:
            name, nodes = seed_template(pair_civilization, case_type)
            templates._seed(tenant, pair_civilization, case_type, name, nodes, False)
