import {
  HookEventType,
  PluginContext,
  PluginHandler,
  PluginParameters,
} from '../types';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { getText } from '../utils';

const ajv = new Ajv({
  allErrors: true,
  verbose: true,
});
addFormats(ajv);

export const handler: PluginHandler = async (
  context: PluginContext,
  parameters: PluginParameters,
  eventType: HookEventType
) => {
  let error = null;
  let verdict = false;
  let data: any = null;

  try {
    const schema = parameters.schema;
    const not = parameters.not || false;
    if (!schema || typeof schema !== 'object') {
      throw new Error('Missing or invalid JSON schema');
    }

    let responseText = getText(context, eventType);

    // Extract JSON from code blocks and general text
    const extractJson = (text: string): string[] => {
      const codeBlockRegex = /```+(?:json)?\s*([\s\S]*?)```+/g;
      const jsonRegex = /{[\s\S]*?}/g;
      const matches = [];

      // Extract from code blocks first
      let match;
      while ((match = codeBlockRegex.exec(text)) !== null) {
        matches.push(match[1].trim());
      }

      // If no matches in code blocks, try general JSON
      if (matches.length === 0) {
        while ((match = jsonRegex.exec(text)) !== null) {
          matches.push(match[0]);
        }
      }

      return matches;
    };

    const jsonMatches = extractJson(responseText);
    const validate = ajv.compile(schema);

    // We will find if there's at least one valid JSON object in the response
    if (jsonMatches.length > 0) {
      let bestMatch = {
        json: null as any,
        errors: [] as any[],
        isValid: false,
      };

      for (const jsonMatch of jsonMatches) {
        let responseJson;
        try {
          responseJson = JSON.parse(jsonMatch);
        } catch (e) {
          continue;
        }

        const isValid = validate(responseJson);

        // Store this result if it's valid or if it's the first one we've processed
        if (isValid || bestMatch.json === null) {
          bestMatch = {
            json: responseJson,
            errors: validate.errors || [],
            isValid,
          };
        }

        // If we found a valid match, no need to check others
        if (isValid) {
          break;
        }
      }

      if (bestMatch.json) {
        verdict = not ? !bestMatch.isValid : bestMatch.isValid;
        data = {
          matchedJson: bestMatch.json,
          not,
          explanation: verdict
            ? not
              ? `Successfully validated JSON does not match the schema as expected.`
              : `Successfully validated JSON against the provided schema.`
            : not
              ? `JSON matches the schema when it should not.`
              : `Failed to validate JSON against the provided schema.`,
          validationErrors: bestMatch.errors.map((err) => ({
            path: err.instancePath || '',
            message: err.message || '',
          })),
        };
      }
    } else {
      data = {
        explanation: 'No valid JSON found in the response.',
        not,
      };
    }
  } catch (e: any) {
    error = e;
    data = {
      explanation: 'An error occurred while processing the JSON.',
      error: e.message || e.toString(),
      not: parameters.not || false,
    };
  }

  return { error, verdict, data };
};
