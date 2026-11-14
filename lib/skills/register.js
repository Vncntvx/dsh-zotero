import { skillRegistration } from './definition.js';
/** Optional registry: arriving/replaced services rebind with the inject fiber. */
export function registerResearchSkills(ctx, sops) {
    ctx.inject(['skills'], (host) => {
        host.effect(() => {
            const disposers = sops.map((sop) => host.skills.register(skillRegistration(sop)));
            return () => {
                for (const dispose of disposers)
                    dispose();
            };
        }, 'zotero: research skills registration');
    });
}
//# sourceMappingURL=register.js.map