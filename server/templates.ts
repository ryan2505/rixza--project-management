import type { TemplateDefinition } from '../shared/domain.ts';

type T = { title: string; visibility?: 'internal' | 'client'; client_action?: boolean; priority?: 'low' | 'medium' | 'high' | 'urgent'; description?: string };
const task = (title: string, opts: Omit<T, 'title'> = {}) => ({ title, visibility: opts.visibility ?? 'client', client_action: opts.client_action, priority: opts.priority, description: opts.description });
const internal = (title: string, opts: Omit<T, 'title' | 'visibility'> = {}) => task(title, { ...opts, visibility: 'internal' });
const phase = (name: string, durationDays: number, description: string, tasks: ReturnType<typeof task>[], milestones: string[] = []) => ({
  name, durationDays, description, tasks, milestones: milestones.map((title) => ({ title })),
});

export const DEFAULT_TEMPLATES: { name: string; project_type: string; description: string; definition: TemplateDefinition }[] = [
  {
    name: 'Website Development',
    project_type: 'Website',
    description: 'Corporate or marketing website from discovery to launch.',
    definition: {
      phases: [
        phase('Discovery & Strategy', 10, 'Understand your goals, audience and constraints.', [
          task('Kick-off workshop', { priority: 'high' }),
          task('Submit company information & brand assets', { client_action: true, priority: 'high', description: 'Logo files, brand guidelines, photography and any existing content.' }),
          internal('Competitive & audience analysis'),
          task('Project brief validation', { client_action: true }),
        ], ['Strategy approved']),
        phase('Planning & Architecture', 10, 'Sitemap, user journeys and technical architecture.', [
          task('Sitemap & page inventory'),
          task('Wireframes for key pages'),
          internal('Technical architecture & hosting plan'),
          task('Review the proposed site structure', { client_action: true }),
        ], ['Structure approved']),
        phase('UI/UX Design', 15, 'Visual direction and high-fidelity designs.', [
          task('Moodboard & visual direction'),
          task('Homepage design', { priority: 'high' }),
          task('Inner page templates'),
          internal('Design system & components'),
        ]),
        phase('Design Validation', 5, 'Your review and approval of the designs.', [
          task('Approve homepage design', { client_action: true, priority: 'high' }),
          task('Approve inner page designs', { client_action: true }),
        ], ['Designs approved']),
        phase('Development', 25, 'Front-end and CMS implementation.', [
          internal('Development environment setup'),
          task('Front-end development'),
          task('CMS integration'),
          internal('Performance & accessibility pass'),
        ], ['First prototype ready']),
        phase('Content Integration', 10, 'Integrate final copy and media.', [
          task('Provide final page content', { client_action: true }),
          task('Content integration'),
        ]),
        phase('Quality Assurance', 7, 'Cross-browser, device and performance testing.', [internal('Cross-browser & device testing'), internal('SEO technical checklist')]),
        phase('Client Review', 5, 'Full review of the staging website.', [task('Validate the staging website', { client_action: true, priority: 'high' })]),
        phase('Final Delivery', 3, 'Final adjustments and handover documentation.', [task('Final adjustments'), task('Handover documentation')]),
        phase('Launch & Handover', 3, 'Go-live and training.', [task('Go-live', { priority: 'urgent' }), task('CMS training session')], ['Website launched']),
      ],
    },
  },
  {
    name: 'E-commerce Development',
    project_type: 'E-commerce',
    description: 'Online store with catalogue, checkout and payment integration.',
    definition: {
      phases: [
        phase('Discovery & Strategy', 10, 'Business model, catalogue and operations.', [task('Kick-off workshop'), task('Share product catalogue & pricing', { client_action: true })], ['Scope validated']),
        phase('UX & Design', 20, 'Store experience and visual design.', [task('Store wireframes'), task('Product & checkout design'), task('Approve store design', { client_action: true })], ['Design approved']),
        phase('Development', 30, 'Store build, payments and shipping.', [task('Store build'), internal('Payment gateway integration'), internal('Shipping & tax rules')], ['Store prototype ready']),
        phase('Catalogue & Content', 10, 'Products, media and copy.', [task('Product import'), task('Validate product pages', { client_action: true })]),
        phase('QA & Launch', 10, 'Testing, payments test and go-live.', [internal('End-to-end order testing'), task('Go-live')], ['Store launched']),
      ],
    },
  },
  {
    name: 'Branding',
    project_type: 'Branding',
    description: 'Brand strategy, identity and guidelines.',
    definition: {
      phases: [
        phase('Brand Discovery', 10, 'Positioning, values and audience.', [task('Brand workshop'), task('Complete brand questionnaire', { client_action: true })], ['Brand platform agreed']),
        phase('Concepts', 15, 'Identity concepts and exploration.', [internal('Creative exploration'), task('Brand identity concepts presentation')]),
        phase('Refinement', 10, 'Develop the chosen direction.', [task('Select a concept direction', { client_action: true }), task('Concept refinement')], ['Identity approved']),
        phase('Guidelines & Delivery', 10, 'Brand book and asset delivery.', [task('Brand guidelines'), task('Final asset package')], ['Brand delivered']),
      ],
    },
  },
  {
    name: 'SaaS Development',
    project_type: 'SaaS',
    description: 'Product discovery, MVP build and launch.',
    definition: {
      phases: [
        phase('Product Discovery', 15, 'Problem framing, users and scope.', [task('Discovery workshops'), task('Validate MVP scope', { client_action: true })], ['MVP scope signed off']),
        phase('UX & Prototype', 20, 'Flows and clickable prototype.', [task('User flows'), task('Clickable prototype'), task('Prototype review', { client_action: true })], ['Prototype validated']),
        phase('MVP Build', 45, 'Iterative sprints.', [internal('Architecture & infrastructure'), task('Sprint 1'), task('Sprint 2'), task('Sprint 3')], ['Beta available']),
        phase('Beta & Launch', 15, 'Beta feedback and production launch.', [task('Beta feedback review', { client_action: true }), task('Production launch')], ['Product launched']),
      ],
    },
  },
  {
    name: 'SEO & Digital Growth',
    project_type: 'Digital Growth',
    description: 'Audit, optimisation and growth roadmap.',
    definition: {
      phases: [
        phase('Audit', 10, 'Technical, content and competitive audit.', [task('Provide analytics & Search Console access', { client_action: true }), task('SEO audit report')], ['Audit delivered']),
        phase('Optimisation', 30, 'On-page and technical improvements.', [task('Technical fixes'), task('On-page optimisation'), internal('Link opportunities research')]),
        phase('Reporting', 20, 'Monthly reporting and recommendations.', [task('Monthly performance report'), task('Growth roadmap review', { client_action: true })], ['Growth roadmap agreed']),
      ],
    },
  },
  {
    name: 'Custom Digital Project',
    project_type: 'Custom',
    description: 'A flexible starting point — adapt phases after creation.',
    definition: {
      phases: [
        phase('Discovery', 10, 'Understand the need.', [task('Kick-off'), task('Share requirements', { client_action: true })], ['Scope agreed']),
        phase('Delivery', 30, 'Design and build.', [task('Execution')]),
        phase('Handover', 5, 'Final review and handover.', [task('Final review', { client_action: true }), task('Handover')], ['Project delivered']),
      ],
    },
  },
];
