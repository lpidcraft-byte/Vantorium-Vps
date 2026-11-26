// railway.js
// Railway GraphQL API üzerinden deployment.
// RAILWAY_TOKEN ve RAILWAY_PROJECT_ID env'den okunur.

const fetch = require('node-fetch');

const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';

async function gql(query, variables = {}) {
  const token = process.env.RAILWAY_TOKEN;
  if (!token) throw new Error('RAILWAY_TOKEN missing');
  const res = await fetch(RAILWAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

// Gerçek Railway project oluşturma + env + deploy
async function createRailwayService({ botName, envVars }) {
  const projectId = process.env.RAILWAY_PROJECT_ID;
  if (!projectId) throw new Error('RAILWAY_PROJECT_ID missing');

  // 1) Service oluştur
  const createServiceMutation = `
    mutation ServiceCreate($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id name }
    }
  `;
  const svcData = await gql(createServiceMutation, {
    input: {
      projectId,
      name: `bot-${botName}-${Date.now()}`.slice(0, 40),
      source: { repo: process.env.RAILWAY_TEMPLATE_REPO || null }
    }
  });
  const serviceId = svcData.serviceCreate.id;

  // 2) Env vars
  if (envVars && Object.keys(envVars).length) {
    const envMutation = `
      mutation VariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }
    `;
    const envInput = {
      projectId,
      serviceId,
      environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
      variables: envVars
    };
    await gql(envMutation, { input: envInput });
  }

  // 3) Deploy
  const deployMutation = `
    mutation ServiceInstanceDeploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `;
  await gql(deployMutation, {
    serviceId,
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID
  });

  return { serviceId, projectId };
}

module.exports = { createRailwayService };
