import { Template } from 'meteor/templating';
import { FlowRouter } from 'meteor/kadira:flow-router';
import { Organizations } from '/both/api/organizations/organizations.js';

Template.page_dashboard.onCreated(function() {
  const self = this;

  self.autorun(function() {
    self.subscribe('organizations.public');
  });
});

const helpers = {
  post() {
    return Organizations.findOne({ slug: FlowRouter.getParam('slug') });
  },
  organizations() {
    const orgCursor = Organizations.find({});
    return orgCursor;
  },
};

Template.page_dashboard.helpers(helpers);
Template.dashboard_header_navigation.helpers(helpers);