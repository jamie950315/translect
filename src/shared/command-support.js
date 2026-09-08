export async function getExtensionCommands(commandsApi) {
  if (typeof commandsApi?.getAll !== "function") {
    return [];
  }

  return await commandsApi.getAll();
}
