import assert from "node:assert/strict";
import test from "node:test";
import { persistPublishers } from "../../../src/storage/persistPublishers.js";
import { SOURCE_IDENTITY_VERSION } from "../../../src/utils/publishingIdentityContract.js";

function identity() {
  return {
    version: SOURCE_IDENTITY_VERSION,
    source_url: "https://the-scientist.com/evidence",
    document: {article_type:"Article",authors:[],identifiers:[]},
    entities: {
      publishing_organization:{name:"The Scientist Magazine",entity_type:"organization",method:"json_ld.publisher",confidence:0.98,evidence:"The Scientist Magazine"},
      publication_venue:{name:"The Scientist",entity_type:"journal",venue_type:"journal",method:"json_ld.isPartOf",confidence:0.94,evidence:"The Scientist"},
      parent_organization:{name:"LabX Media Group",entity_type:"organization",method:"visible_provenance_statement",confidence:0.92,evidence:"part of the LabX Media Group",relationship_type:"part_of"},
      original_publisher:{name:"The Conversation",entity_type:"organization",method:"visible_republication_statement",confidence:0.96,evidence:"republished from The Conversation"},
    },
    context: {
      context_type:"scholarly",publisher_name_observed:"The Scientist Magazine",venue_name:"The Scientist",venue_type:"journal",
      extraction_method:"json_ld.publisher",extraction_confidence:0.98,
      publication_relationship:{type:"republished",license:"Creative Commons",evidenceText:"republished from The Conversation",originalUrl:"https://theconversation.com/original"},
      raw_metadata:{publication_relationship:{type:"republished",license:"Creative Commons",evidenceText:"republished from The Conversation",originalUrl:"https://theconversation.com/original"}},
    },
    candidates:[],warnings:[],
  };
}

test("publishing provenance persists role links and explicit publisher relationships", async () => {
  let nextPublisherId = 100;
  const ids = new Map<string,number>();
  const contentRoles:Array<{publisherId:number;role:string;primary:number}> = [];
  const relationships:Array<{publisherId:number;relatedId:number;type:string;url:string|null;raw:any}> = [];
  const query = async (sql:string, values:any[] = []) => {
    if (sql.includes("SELECT publisher_id") && sql.includes("FROM publishers")) {
      const id = ids.get(String(values[0]));
      return id ? [{publisher_id:id}] : [];
    }
    if (sql.startsWith("INSERT INTO publishers")) {
      const id = ++nextPublisherId;
      ids.set(String(values[0]), id);
      return {insertId:id,affectedRows:1};
    }
    if (sql.startsWith("INSERT INTO content_publishing_context")) return {insertId:700,affectedRows:1};
    if (sql.startsWith("INSERT INTO content_publishers")) {
      contentRoles.push({publisherId:Number(values[1]),role:String(values[2]),primary:Number(values[3])});
      return {insertId:800,affectedRows:1};
    }
    if (sql.includes("SELECT id FROM publisher_relationships")) return [];
    if (sql.startsWith("INSERT INTO publisher_relationships")) {
      if (sql.includes("'publishes'")) {
        relationships.push({publisherId:Number(values[0]),relatedId:Number(values[1]),type:"publishes",url:null,raw:values[4]});
      } else {
        relationships.push({publisherId:Number(values[0]),relatedId:Number(values[1]),type:String(values[3]),url:values[5],raw:values[7]});
      }
      return {insertId:900,affectedRows:1};
    }
    return {affectedRows:1};
  };
  await persistPublishers(query as any, 55, identity() as any, {transaction:false});
  assert.deepEqual(
    contentRoles.map((row) => row.role).sort(),
    ["original_publisher","parent_organization","publication_venue","publishing_organization"].sort(),
  );
  assert.equal(contentRoles.find((row) => row.role === "original_publisher")?.primary, 1);
  assert.equal(contentRoles.find((row) => row.role === "publication_venue")?.primary, 0);
  assert.ok(relationships.some((row) => row.type === "part_of"));
  const republished = relationships.find((row) => row.type === "republished_from");
  assert.equal(republished?.url, "https://theconversation.com/original");
  assert.match(String(republished?.raw), /Creative Commons/u);
});
