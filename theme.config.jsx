
export default {
    logo: 'Clerk Docs',
    useNextSeoProps() {
      return {
        titleTemplate: '%s – Clerk'
      }
    },
    docsRepositoryBase: 'https://github.com/clerkinc/clerk-docs/',
    project: {
      link: 'https://clerk.dev',
    },
    sidebar:{
      defaultMenuCollapseLevel: 1,
      toggleButton: true,
    
    },
    navigation: false,
    footer: {
      text: <span>
        {new Date().getFullYear()} © <a href="https://clerk.dev" target="_blank" rel="noreferrer">Clerk</a>.
      </span>,
    }
  }