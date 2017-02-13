import util from 'util';
import { Meteor } from 'meteor/meteor';
import { Sources } from '/both/api/sources/sources';
import { check } from 'meteor/check';
import { SourceImports } from '../source-imports.js';
import { publishPublicFields } from '/server/publish';
import { publishPrivateFieldsForMembers } from '/both/api/organizations/server/publications';

publishPublicFields('sourceImports', SourceImports);
publishPrivateFieldsForMembers('sourceImports', SourceImports);

Meteor.publish('sourceImports.stats.public', function publish(sourceId) {
  check(sourceId, String);
  this.autorun(() => {
    const source = Sources.findOne(sourceId);
    if (!source) {
      return [];
    }

    const visibleSelector = SourceImports.visibleSelectorForUserId(this.userId);

    let selector;
    if (source.isFreelyAccessible) {
      selector = { sourceId };
    } else {
      selector = { $and: [visibleSelector, { sourceId }] };
    }

    return SourceImports.find(
      selector,
      { fields: SourceImports.statsFields }
    );
  });
});
