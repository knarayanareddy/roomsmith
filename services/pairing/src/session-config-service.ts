import {
  PairingService,
  type PlayerRole,
  type PrePlaySetupInput,
  type SessionAccessibilitySettings,
  type SessionConfigurationRecord,
} from "./pairing-service.js";

export interface AllowlistedKitObjectDefinition {
  object_id: "red_cup" | "blue_cup" | "book" | "bottle" | "spoon";
  detector_class: "cup" | "book" | "bottle" | "spoon";
  color: "red" | "blue" | "neutral";
  required: boolean;
  accessible_label: string;
}

export const OBJECT_KIT_CATALOG: ReadonlyArray<AllowlistedKitObjectDefinition> =
  [
    {
      object_id: "red_cup",
      detector_class: "cup",
      color: "red",
      required: true,
      accessible_label: "Cup labeled red lens",
    },
    {
      object_id: "blue_cup",
      detector_class: "cup",
      color: "blue",
      required: true,
      accessible_label: "Cup labeled blue lens",
    },
    {
      object_id: "book",
      detector_class: "book",
      color: "neutral",
      required: true,
      accessible_label: "Book labeled archive",
    },
    {
      object_id: "bottle",
      detector_class: "bottle",
      color: "neutral",
      required: false,
      accessible_label: "Bottle labeled condenser",
    },
    {
      object_id: "spoon",
      detector_class: "spoon",
      color: "neutral",
      required: false,
      accessible_label: "Spoon labeled key lever",
    },
  ];

export interface PlayerSessionConfigRequest {
  session_id?: string;
  episode_id: string;
  content_version: string;
  player_count: number;
  selected_object_kit: string[];
  accessibility: SessionAccessibilitySettings & {
    color_independent_labels?: boolean;
  };
  adult_supervision_confirmed: boolean;
  privacy_notice_acknowledged: boolean;
  now_ms?: number;
  idempotency_key?: string;
}

export interface ValidatedPlayerSessionConfig {
  session: SessionConfigurationRecord;
  resolved_kit_objects: AllowlistedKitObjectDefinition[];
  color_independent_labels: true;
  roles: PlayerRole[];
  solo_path: boolean;
}

const CATALOG_BY_ID = new Map(
  OBJECT_KIT_CATALOG.map((item) => [item.object_id as string, item]),
);

/**
 * Dedicated player session configuration service for FR-RS-002:
 * validates player count (1–4), object kit allowlist and mandatory items,
 * accessibility settings (including non-color labels), adult supervisor consent,
 * and local-only privacy notice acknowledgement before play.
 */
export class PlayerSessionConfigurationService {
  constructor(private readonly pairingService = new PairingService()) {}

  getCatalog(): ReadonlyArray<AllowlistedKitObjectDefinition> {
    return structuredClone(OBJECT_KIT_CATALOG);
  }

  configureSession(
    request: PlayerSessionConfigRequest,
  ): ValidatedPlayerSessionConfig {
    if (
      request.accessibility &&
      request.accessibility.color_independent_labels === false
    ) {
      throw new Error("color_independent_labels_required");
    }

    const setupInput: PrePlaySetupInput = {
      ...(request.session_id !== undefined
        ? { session_id: request.session_id }
        : {}),
      episode_id: request.episode_id,
      content_version: request.content_version,
      player_count: request.player_count,
      selected_object_kit: request.selected_object_kit,
      accessibility: {
        no_timing_mode: request.accessibility?.no_timing_mode,
        reduced_motion: request.accessibility?.reduced_motion,
        captions: request.accessibility?.captions,
        remote_only: request.accessibility?.remote_only,
        larger_text: request.accessibility?.larger_text,
      },
      adult_supervision_confirmed: request.adult_supervision_confirmed,
      privacy_notice_acknowledged: request.privacy_notice_acknowledged,
      ...(request.now_ms !== undefined ? { now_ms: request.now_ms } : {}),
      ...(request.idempotency_key !== undefined
        ? { idempotency_key: request.idempotency_key }
        : {}),
    };

    const session = this.pairingService.createSession(setupInput);
    const resolvedKit = session.selected_object_kit.map((id) => {
      const def = CATALOG_BY_ID.get(id);
      if (!def) {
        throw new Error(`unallowlisted_kit_object:${id}`);
      }
      return structuredClone(def);
    });

    return {
      session,
      resolved_kit_objects: resolvedKit,
      color_independent_labels: true,
      roles: [...session.assigned_roles],
      solo_path: session.solo_path,
    };
  }
}
