---
triggers:
  - provider: linear
    event: issue_labeled
    filter:
      teams: [JOP]
      projects: [Marky]
      labels: [factory]
---
Use the Linear issue that triggered this run as the request:

- author: the requester
- URL: the Linear issue this work tracks; link the pull request on the GitHub tracking issue, and put the Linear identifier (for example JOP-26) in the pull request title so Linear links it
- title / description: the description to follow
