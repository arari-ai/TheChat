# Optional HRM employee provisioning

The application remains independently installable. New account creation is disabled by default and available only through the named `HrmProvisioning` Cloudflare service binding. The public Worker does not route this API. Existing HRM Bearer credentials do not gain account-creation authority.

The HRM source ID and immutable person ID identify an employee. A repeated request retains the native account ID. Existing email matches are held for administrator review; retry does not automatically merge them or change their permissions. Privileged roles require explicit selection. A provisioned TheID account stays blocked from native staff login while identity linking is pending, during provider outages, and after stops. Local standalone provisioning is separate. Provisioning itself sends no invitation or verification email.

## Deployment

Apply additive migrations before enabling. Set deployment vars explicitly for this company: `PROVISIONING_ENABLED="true"`, `PROVISION_SOURCE_ID` to the HRM directory's immutable `source_id`, and `PROVISION_ALLOWED_ORIGIN` to the exact HTTPS HRM origin. Do not put secrets in the deployment JSON. Creation accepts only the configured origin/source over a dedicated service binding; never publish a `/v1/accounts` route.

Bind HRM's `PROVISION_APP_CHAT` to this Worker's `HrmProvisioning` entrypoint. For identity linking, bind TheID's `ID_APP_CHAT` to `TheIdProtocol`. That entrypoint exposes only the existing signed `/_theid/*` protocol. Use the application's existing TheID client configuration and secret; no new client credential is created by provisioning.

The HRM job records each native account and identity grant. An app is shown as usable only after the normal signed event delivery acknowledges the exact native ID and revisions. Partial outages remain resumable; review conflicts remain visible. Scheduling departure cancels pending creation. Starting stops sends a generation tombstone to every selected target, including targets not yet created. One unavailable target does not prevent stopping the others. Stops do not erase business records or automatically reactivate on retry. Automatic rehire/security-stop resolution is outside this feature.

TheChat uses `hub.config.json` field `provisioning: {enabled:true, sourceId:"<HRM source>", hrmOrigin:"<exact HRM HTTPS origin>"}` instead of raw deployment vars. These private settings are excluded from public HUB_CONFIG. Ordinary users are members; existing guest and space permissions remain independent.
